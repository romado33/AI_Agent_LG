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
import cron from "node-cron";
import http from "node:http";

import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { StateGraph, START, END } from "@langchain/langgraph";

import { taskSystemMessage } from "./core/instructions.js";
import { toolsJobs, toolsSubs, toolsWeather, toolsSentiment, toolsResume } from "./core/tools.js";
import { writeResume } from "./core/storage.js";
import { getUserMemory, addToHistory, getMemorySummary, updatePreference } from "./core/memory.js";
import { initializeRAG, addResumeToRAG, addJobToRAG } from "./core/rag.js";
import { createCallbacks } from "./core/callbacks.js";
import { createMultiAgentTeam } from "./core/multiAgent.js";
import { toolsFinancial } from "./core/financial.js";
import { toolsResearch } from "./core/research.js";
import { toolsMeeting } from "./core/meeting.js";
import { toolsTravelEnhanced } from "./core/travel.js";
import { toolsSocial } from "./core/social.js";
import { toolsHealth } from "./core/health.js";
import { toolsGitHubMCP, toolsBrowserMCP, toolsNotionMCP } from "./core/mcp.js";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

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
    .enum([
      "chat",
      "jobs",
      "subs",
      "weather",
      "sentiment",
      "resume",
      "news",
      "financial",
      "research",
      "meeting",
      "travel",
      "social",
      "health",
      "multi-agent",
    ])
    .default("chat"),
  sid: z.string().min(3).default("default"),
  stream: z.boolean().default(false),
});
const RespSchema = z.object({
  answer: z.string(),
  next_action: z.enum(["none", "added", "listed", "updated", "imported", "error"]).default("none"),
  data: z.record(z.any()).default({}),
});

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL?.trim() || "http://127.0.0.1:5057";

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
            reject(new Error(`Failed to parse scanner response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", (err) => {
      reject(new Error(`Scanner request failed: ${err.message}`));
    });
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
function makeGraph(task, sid, callbacks) {
  const getContext = () => ({ sid });

  // Core tools
  const { addJob, listJobs, updateJob, importJobsFromGmail } = toolsJobs(langgraphToolFactory);
  const { addSubscription, listSubscriptions, updateSubscription, importSubscriptionsFromGmail } =
    toolsSubs(langgraphToolFactory);
  const { getWeather } = toolsWeather(langgraphToolFactory);
  const { analyzeSentiment } = toolsSentiment(langgraphToolFactory);
  const { resumeStatus, resumeAsk, resumeImprove } = toolsResume(langgraphToolFactory, getContext);

  // Enhanced tools
  const financialTools = toolsFinancial(langgraphToolFactory, getContext);
  const researchTools = toolsResearch(langgraphToolFactory);
  const meetingTools = toolsMeeting(langgraphToolFactory, getContext);
  const travelTools = toolsTravelEnhanced(langgraphToolFactory);
  const socialTools = toolsSocial(langgraphToolFactory);
  const healthTools = toolsHealth(langgraphToolFactory, getContext);
  const githubTools = toolsGitHubMCP(langgraphToolFactory);
  const browserTools = toolsBrowserMCP(langgraphToolFactory);
  const notionTools = toolsNotionMCP(langgraphToolFactory);

  // Multi-agent team (for job search)
  const multiAgentTools = createMultiAgentTeam(langgraphToolFactory, getContext);

  const runNewsDigest = new DynamicStructuredTool({
    name: "runNewsDigest",
    description:
      "Run the local Python digest script to produce today's AI news HTML+MD and (optionally) email it.",
    schema: z.object({
      email: z.string().email().optional(),
      python: z.string().optional().describe('Python exe: "python" (default) or "py"'),
    }),
    func: async ({ email, python }) => {
      if (callbacks) {
        callbacks.onToolStart("runNewsDigest", { email, python });
      }
      try {
        const result = await runNewsDigestExec({ email, python });
        if (callbacks) {
          callbacks.onToolEnd("runNewsDigest", result);
        }
        return result;
      } catch (error) {
        if (callbacks) {
          callbacks.onError(error, "runNewsDigest");
        }
        throw error;
      }
    },
  });

  // Collect all tools
  const allTools = [
    // Core
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
    // Financial
    financialTools.analyzeSubscriptions,
    financialTools.optimizeSubscriptions,
    financialTools.trackROI,
    // Research
    researchTools.researchCompany,
    researchTools.researchRole,
    researchTools.researchIndustry,
    researchTools.analyzeJobPosting,
    // Meeting
    meetingTools.summarizeMeeting,
    meetingTools.extractInterviewInsights,
    meetingTools.createFollowUp,
    // Travel
    travelTools.planTrip,
    travelTools.findFlights,
    travelTools.findHotels,
    travelTools.getTravelRecommendations,
    // Social
    socialTools.monitorLinkedIn,
    socialTools.monitorTwitter,
    socialTools.trackCompanyUpdates,
    socialTools.analyzeJobMarketTrends,
    // Health
    healthTools.trackWorkLifeBalance,
    healthTools.suggestBreaks,
    healthTools.trackProductivity,
    // MCP
    githubTools.searchRepositories,
    githubTools.getRepositoryInfo,
    githubTools.getIssues,
    browserTools.scrapeWebPage,
    browserTools.searchWeb,
    notionTools.createNotionPage,
    notionTools.searchNotion,
    // Multi-agent
    ...Object.values(multiAgentTools),
  ];

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const llmWithTools = llm.bindTools(allTools);

  const graph = new StateGraph({
    channels: { messages: { default: () => [], value: (p, n) => p.concat(n) } },
  });

  graph.addNode("model", async (state) => {
    if (callbacks) {
      callbacks.onLLMStart(JSON.stringify(state.messages));
    }
    const result = await llmWithTools.invoke(state.messages);
    if (callbacks) {
      callbacks.onLLMEnd(result.content);
    }
    return { messages: [result] };
  });

  graph.addNode("tool", async (state) => {
    const last = state.messages[state.messages.length - 1];
    const tc = last.tool_calls?.[0];
    if (!tc) {
      return { messages: [] };
    }

    const catalog = {
      // Core
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
      // Financial
      analyzeSubscriptions: financialTools.analyzeSubscriptions,
      optimizeSubscriptions: financialTools.optimizeSubscriptions,
      trackROI: financialTools.trackROI,
      // Research
      researchCompany: researchTools.researchCompany,
      researchRole: researchTools.researchRole,
      researchIndustry: researchTools.researchIndustry,
      analyzeJobPosting: researchTools.analyzeJobPosting,
      // Meeting
      summarizeMeeting: meetingTools.summarizeMeeting,
      extractInterviewInsights: meetingTools.extractInterviewInsights,
      createFollowUp: meetingTools.createFollowUp,
      // Travel
      planTrip: travelTools.planTrip,
      findFlights: travelTools.findFlights,
      findHotels: travelTools.findHotels,
      getTravelRecommendations: travelTools.getTravelRecommendations,
      // Social
      monitorLinkedIn: socialTools.monitorLinkedIn,
      monitorTwitter: socialTools.monitorTwitter,
      trackCompanyUpdates: socialTools.trackCompanyUpdates,
      analyzeJobMarketTrends: socialTools.analyzeJobMarketTrends,
      // Health
      trackWorkLifeBalance: healthTools.trackWorkLifeBalance,
      suggestBreaks: healthTools.suggestBreaks,
      trackProductivity: healthTools.trackProductivity,
      // MCP
      searchRepositories: githubTools.searchRepositories,
      getRepositoryInfo: githubTools.getRepositoryInfo,
      getIssues: githubTools.getIssues,
      scrapeWebPage: browserTools.scrapeWebPage,
      searchWeb: browserTools.searchWeb,
      createNotionPage: notionTools.createNotionPage,
      searchNotion: notionTools.searchNotion,
      // Multi-agent
      ...multiAgentTools,
    };

    const t = catalog[tc.name];
    if (!t) {
      const error = { error: `Unknown tool ${tc.name}` };
      if (callbacks) {
        callbacks.onError(new Error(`Unknown tool: ${tc.name}`), "tool");
      }
      return {
        messages: [
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(error),
          }),
        ],
      };
    }

    if (callbacks) {
      callbacks.onToolStart(tc.name, tc.args);
    }
    try {
      const result = await t.invoke(tc.args || {});
      if (callbacks) {
        callbacks.onToolEnd(tc.name, result);
      }
      return {
        messages: [
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(result),
          }),
        ],
      };
    } catch (error) {
      if (callbacks) {
        callbacks.onError(error, tc.name);
      }
      return {
        messages: [
          new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify({ error: error.message }),
          }),
        ],
      };
    }
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

// Enhanced chat with memory, streaming, and callbacks
app.post("/chat", async (req, res, next) => {
  try {
    const { prompt, task = "chat", sid = "default", stream = false } = req.body || {};
    const parsed = ChatSchema.parse({ prompt, task, sid, stream });

    // Initialize callbacks for tracking
    const callbacks = createCallbacks(parsed.sid);

    // Load user memory
    const memory = await getUserMemory(parsed.sid);
    const memorySummary = await getMemorySummary(parsed.sid);

    // Add memory context to system message
    const memoryContext = memorySummary.recentFacts.length > 0
      ? `\nUser context: ${memorySummary.recentFacts.slice(-3).map((f) => f.fact).join("; ")}`
      : "";

    // Fast path: simple chat → call the model directly
    if (task === "chat" && !stream) {
      const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
      const systemMessage = `You are a helpful assistant. Answer clearly and concisely.${memoryContext}`;
      const r = await llm.invoke([
        { role: "system", content: systemMessage },
        ...memory.conversationHistory.slice(-10),
        { role: "user", content: prompt || "" },
      ]);
      const text = typeof r?.content === "string" ? r.content : String(r?.content ?? "");

      // Save to memory
      await addToHistory(parsed.sid, "user", prompt || "");
      await addToHistory(parsed.sid, "assistant", text);

      return res.json({
        answer: text,
        next_action: "none",
        data: {},
        memory: memorySummary,
      });
    }

    // Streaming path
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const llm = new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0,
        streaming: true,
      });

      const systemMessage = `${taskSystemMessage(parsed.task)}${memoryContext}`;
      const stream = await llm.stream([
        { role: "system", content: systemMessage },
        ...memory.conversationHistory.slice(-10),
        { role: "user", content: parsed.prompt },
      ]);

      let fullResponse = "";
      for await (const chunk of stream) {
        const content = chunk.content || "";
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }

      await addToHistory(parsed.sid, "user", parsed.prompt);
      await addToHistory(parsed.sid, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Original LangGraph path for tool-driven tasks
    const prior = memory.conversationHistory.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const appGraph = makeGraph(parsed.task, parsed.sid, callbacks);

    const result = await appGraph.invoke({
      messages: [
        { role: "system", content: taskSystemMessage(parsed.task) + memoryContext },
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

    // Save to memory
    await addToHistory(parsed.sid, "user", parsed.prompt);
    await addToHistory(parsed.sid, "assistant", payload.answer);

    res.json({
      ...payload,
      memory: memorySummary,
      callbacks: {
        toolUsage: callbacks.getToolUsage(),
        events: callbacks.getEvents().slice(-10),
      },
    });
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
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file" });
    }
    if (!/pdf$/i.test(req.file.originalname) || req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ ok: false, error: "Only PDF supported" });
    }
    const data = await pdf(req.file.buffer);
    const text = (data.text || "").trim();
    await writeResume(sid, text);
    // Add to RAG
    try {
      await addResumeToRAG(sid, text);
    } catch (error) {
      logger.warn({ err: error }, "Failed to add resume to RAG");
    }
    res.json({ ok: true, chars: text.length, ragIndexed: true });
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
app.post("/api/jobs/import_csv", async (req, res, _next) => {
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

// Initialize RAG on startup
initializeRAG().catch((err) => {
  logger.warn({ err }, "RAG initialization failed - continuing without RAG");
});

// Memory API endpoints
app.get("/api/memory/:sid", async (req, res) => {
  try {
    const summary = await getMemorySummary(req.params.sid);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/memory/:sid/preference", async (req, res) => {
  try {
    const { key, value } = req.body;
    await updatePreference(req.params.sid, key, value);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info(`LangGraph adapter: http://localhost:${port}`));
