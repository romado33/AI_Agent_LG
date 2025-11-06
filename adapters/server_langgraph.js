// adapters/server_langgraph.js
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import cron from "node-cron";
import http from "node:http";

import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { StateGraph, START, END } from "@langchain/langgraph";

import { taskSystemMessage } from "./core/instructions.js";
import {
  toolsJobs,
  toolsSubs,
  toolsWeather,
  toolsSentiment,
  toolsResume,
} from "./core/tools.js";
import { writeResume } from "./core/storage.js";

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(pinoHttp({ logger, genReqId: () => randomUUID() }));
app.use(express.static(path.resolve(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/whoami", (_req, res) => res.json({ name: "LangGraph" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => res.json({ ok: !!process.env.OPENAI_API_KEY }));

// Debug route: list registered routes
app.get("/__routes", (_req, res) => {
  const routes = (app._router?.stack || [])
    .filter((l) => l.route)
    .map((l) => `${Object.keys(l.route.methods).join("|").toUpperCase()} ${l.route.path}`);
  res.json({ routes });
});

// ---- utilities -------------------------------------------------------------
function langgraphToolFactory({ name, description, schema, impl }) {
  return new DynamicStructuredTool({ name, description, schema, func: impl });
}
const sessions = new Map();

const ChatSchema = z.object({
  prompt: z.string().min(1),
  task: z
    .enum(["chat", "jobs", "subs", "weather", "sentiment", "resume", "news"])
    .default("chat"),
  sid: z.string().min(3).default("default"),
});
const RespSchema = z.object({
  answer: z.string(),
  next_action: z
    .enum(["none", "added", "listed", "updated", "imported", "error"])
    .default("none"),
  data: z.record(z.any()).default({}),
});

const SCANNER_BASE_URL =
  process.env.SCANNER_BASE_URL?.trim() || "http://127.0.0.1:5057";

function postScanner(pathname, body = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(SCANNER_BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port || 5057),
        path: pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf || "{}"));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function csvEscape(s = "") {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toCSV(rows, headers) {
  const headerLine = headers.map(csvEscape).join(",");
  const lines = rows.map((r) => headers.map((h) => csvEscape(r[h] ?? "")).join(","));
  return [headerLine, ...lines].join("\n");
}

// ---- news digest (optional Python) ----------------------------------------
async function runNewsDigestExec({ email, python } = {}) {
  const py = python || "python";
  const script = path.join(__dirname, "news", "aggregate_ai_news.py");
  const cwd = path.join(__dirname, "news");

  const stdout = [];
  const stderr = [];
  await new Promise((resolve, reject) => {
    const child = spawn(py, [script], {
      cwd,
      env: { ...process.env, DIGEST_TO: email || process.env.DIGEST_TO || "" },
    });
    child.stdout.on("data", (d) => stdout.push(d.toString()));
    child.stderr.on("data", (d) => stderr.push(d.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(0) : reject(new Error(`news exit ${code}\n${stderr.join("")}`))
    );
  });

  const outDir = path.join(cwd, "ai_digest_output");
  const entries = await fs.readdir(outDir).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  const md = entries.find((f) => f.endsWith(`${today}.md`)) || null;
  const html = entries.find((f) => f.endsWith(`${today}.html`)) || null;

  return {
    ok: true,
    stdout: stdout.join("").trim(),
    out_dir: outDir,
    md_path: md ? path.join(outDir, md) : null,
    html_path: html ? path.join(outDir, html) : null,
  };
}

// ---- graph ---------------------------------------------------------------
function makeGraph(task, sid) {
  const { addJob, listJobs, updateJob, importJobsFromGmail } =
    toolsJobs(langgraphToolFactory);
  const {
    addSubscription,
    listSubscriptions,
    updateSubscription,
    importSubscriptionsFromGmail,
  } = toolsSubs(langgraphToolFactory);
  const { getWeather } = toolsWeather(langgraphToolFactory);
  const { analyzeSentiment } = toolsSentiment(langgraphToolFactory);
  const { resumeStatus, resumeAsk, resumeImprove } = toolsResume(
    langgraphToolFactory,
    () => ({ sid })
  );

  const runNewsDigest = new DynamicStructuredTool({
    name: "runNewsDigest",
    description:
      "Run the local Python digest script to produce today's AI news HTML+MD and (optionally) email it.",
    schema: z.object({
      email: z.string().email().optional(),
      python: z.string().optional().describe('Python exe: "python" (default) or "py"'),
    }),
    func: async ({ email, python }) => runNewsDigestExec({ email, python }),
  });

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const llmWithTools = llm.bindTools([
    addJob,
    listJobs,
    updateJob,
    importJobsFromGmail,
    addSubscription,
    listSubscriptions,
    updateSubscription,
    importSubscriptionsFromGmail,
    getWeather,
    analyzeSentiment,
    resumeStatus,
    resumeAsk,
    resumeImprove,
    runNewsDigest,
  ]);

  const graph = new StateGraph({
    channels: { messages: { default: () => [], value: (p, n) => p.concat(n) } },
  });

  graph.addNode("model", async (state) => ({
    messages: [await llmWithTools.invoke(state.messages)],
  }));

  graph.addNode("tool", async (state) => {
    const last = state.messages[state.messages.length - 1];
    const tc = last.tool_calls?.[0];
    if (!tc) return { messages: [] };

    const catalog = {
      addJob,
      listJobs,
      updateJob,
      importJobsFromGmail,
      addSubscription,
      listSubscriptions,
      updateSubscription,
      importSubscriptionsFromGmail,
      getWeather,
      analyzeSentiment,
      resumeStatus,
      resumeAsk,
      resumeImprove,
      runNewsDigest,
    };

    const t = catalog[tc.name];
    const result = t ? await t.invoke(tc.args || {}) : { error: `Unknown tool ${tc.name}` };
    return {
      messages: [
        new ToolMessage({
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(result),
        }),
      ],
    };
  });

  graph.addConditionalEdges(
    "model",
    (state) => {
      const last = state.messages[state.messages.length - 1];
      return last.tool_calls?.length ? "tool" : END;
    },
    { tool: "tool", [END]: END }
  );
  graph.addEdge("tool", "model");
  graph.addEdge(START, "model");

  return graph.compile();
}

// ---- routes ---------------------------------------------------------------

// UPDATED: fast path for plain chat
app.post("/chat", async (req, res, next) => {
  try {
    const { prompt, task = "chat", sid = "default" } = req.body || {};

    // Fast path: simple chat → call the model directly
    if (task === "chat") {
      const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
      const r = await llm.invoke([
        { role: "system", content: "You are a helpful assistant. Answer clearly and concisely." },
        { role: "user", content: prompt || "" },
      ]);
      const text = typeof r?.content === "string" ? r.content : String(r?.content ?? "");
      // keep minimal session history
      const prior = sessions.get(sid) || [];
      sessions.set(
        sid,
        [...prior, { role: "user", content: prompt || "" }, { role: "assistant", content: text }].slice(-10)
      );
      return res.json({ answer: text, next_action: "none", data: {} });
    }

    // Original LangGraph path for tool-driven tasks
    const parsed = ChatSchema.parse({ prompt, task, sid });
    const prior = sessions.get(parsed.sid) || [];
    const appGraph = makeGraph(parsed.task, parsed.sid);

    const result = await appGraph.invoke({
      messages: [
        { role: "system", content: taskSystemMessage(parsed.task) },
        ...prior,
        { role: "user", content: parsed.prompt },
      ],
    });

    const last = result.messages[result.messages.length - 1];
    let payload;
    try {
      payload = RespSchema.parse(
        typeof last.content === "string"
          ? JSON.parse(last.content)
          : JSON.parse(String(last.content))
      );
    } catch {
      const text = typeof last.content === "string" ? last.content : String(last.content);
      payload = { answer: text, next_action: "none", data: {} };
    }

    const updated = [
      ...prior,
      { role: "user", content: parsed.prompt },
      { role: "assistant", content: payload.answer },
    ].slice(-10);
    sessions.set(parsed.sid, updated);

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});
app.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    const sid = (req.query.sid || req.body?.sid || "default").toString();
    if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
    if (
      !/pdf$/i.test(req.file.originalname) ||
      req.file.mimetype !== "application/pdf"
    ) {
      return res.status(400).json({ ok: false, error: "Only PDF supported" });
    }
    const data = await pdf(req.file.buffer);
    const text = (data.text || "").trim();
    await writeResume(sid, text);
    res.json({ ok: true, chars: text.length });
  } catch (e) {
    next(e);
  }
});

app.post("/news/run", async (req, res, next) => {
  try {
    const email = req.body?.email || req.query?.email;
    const python = req.body?.python || req.query?.python;
    const result = await runNewsDigestExec({ email, python });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ---- jobs import → CSV download -------------------------------------------
app.post("/api/jobs/import_csv", async (req, res, next) => {
  try {
    const daysBack = Number(req.body?.daysBack ?? 7);
    req.log?.info({ daysBack }, "import_csv start");

    const scan = await postScanner("/scan_jobs", { daysBack });
    req.log?.info(
      { scanCount: Array.isArray(scan?.items) ? scan.items.length : null, scanMode: scan?.mode },
      "scanner responded"
    );

    const items = Array.isArray(scan?.items) ? scan.items : [];
    const rows = items.map((x) => ({
      date: x.date || "",
      source: x.source || "",
      subject: x.subject || "",
      link: x.link || "",
      snippet: x.snippet || "",
    }));
    const headers = ["date", "source", "subject", "link", "snippet"];
    const csv = toCSV(rows, headers);

    const outDir = path.join(__dirname, "..", "exports");
    await fs.mkdir(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const filename = `jobs_${ts}.csv`;
    const fullpath = path.join(outDir, filename);
    await fs.writeFile(fullpath, csv, "utf8");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  } catch (e) {
    req.log?.error({ err: e }, "import_csv error");
    res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
});

// ---- errors ---------------------------------------------------------------
app.use((err, req, res, _next) => {
  req.log?.error({ err }, "unhandled_error");
  res.status(500).json({ error: err?.message || "Unexpected server error" });
});

// ---- optional daily cron ---------------------------------------------------
if (process.env.NEWS_CRON_ENABLED === "1") {
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        await runNewsDigestExec({});
        logger.info("Daily AI News digest completed.");
      } catch (e) {
        logger.error({ err: e }, "Daily AI News digest failed.");
      }
    },
    { timezone: "America/Toronto" }
  );
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info(`LangGraph adapter: http://localhost:${port}`));
