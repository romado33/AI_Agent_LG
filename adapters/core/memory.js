import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const memoryDir = path.resolve(__dirname, "..", "data", "memory");

export async function ensureMemoryDir() {
  await fs.mkdir(memoryDir, { recursive: true });
}

export async function getUserMemory(sid) {
  await ensureMemoryDir();
  const file = path.join(memoryDir, `${sid}.json`);
  try {
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content);
  } catch {
    return {
      preferences: {},
      context: {},
      conversationHistory: [],
      facts: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function saveUserMemory(sid, memory) {
  await ensureMemoryDir();
  const file = path.join(memoryDir, `${sid}.json`);
  memory.lastUpdated = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(memory, null, 2), "utf8");
}

export async function updatePreference(sid, key, value) {
  const memory = await getUserMemory(sid);
  memory.preferences[key] = value;
  await saveUserMemory(sid, memory);
}

export async function addFact(sid, fact) {
  const memory = await getUserMemory(sid);
  memory.facts.push({
    fact,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 100 facts
  if (memory.facts.length > 100) {
    memory.facts = memory.facts.slice(-100);
  }
  await saveUserMemory(sid, memory);
}

export async function addToHistory(sid, role, content) {
  const memory = await getUserMemory(sid);
  memory.conversationHistory.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  // Keep last 50 messages
  if (memory.conversationHistory.length > 50) {
    memory.conversationHistory = memory.conversationHistory.slice(-50);
  }
  await saveUserMemory(sid, memory);
}

export async function updateContext(sid, key, value) {
  const memory = await getUserMemory(sid);
  memory.context[key] = value;
  await saveUserMemory(sid, memory);
}

export async function getMemorySummary(sid) {
  const memory = await getUserMemory(sid);
  return {
    preferences: memory.preferences,
    recentFacts: memory.facts.slice(-10),
    context: memory.context,
    conversationCount: memory.conversationHistory.length,
  };
}

