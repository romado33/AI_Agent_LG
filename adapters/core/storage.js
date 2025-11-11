import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.resolve(__dirname, "..", "data");
const jobsFile = path.join(dataDir, "jobs.json");
const subsFile = path.join(dataDir, "subscriptions.json");
const resumesDir = path.join(dataDir, "resumes");

export async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(resumesDir, { recursive: true });
  try {
    await fs.access(jobsFile);
  } catch {
    await fs.writeFile(jobsFile, "[]", "utf8");
  }
  try {
    await fs.access(subsFile);
  } catch {
    await fs.writeFile(subsFile, "[]", "utf8");
  }
}

export async function readJson(kind) {
  await ensureStore();
  const file = kind === "jobs" ? jobsFile : subsFile;
  try {
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to read ${kind} data: ${error.message}`);
  }
}

export async function writeJson(kind, rows) {
  await ensureStore();
  const file = kind === "jobs" ? jobsFile : subsFile;
  try {
    await fs.writeFile(file, JSON.stringify(rows, null, 2), "utf8");
  } catch (error) {
    throw new Error(`Failed to write ${kind} data: ${error.message}`);
  }
}
export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Résumé helpers
export async function writeResume(sid, text) {
  await ensureStore();
  await fs.writeFile(path.join(resumesDir, `${sid}.txt`), text || "", "utf8");
}
export async function readResume(sid) {
  try {
    return await fs.readFile(path.join(resumesDir, `${sid}.txt`), "utf8");
  } catch {
    return "";
  }
}
