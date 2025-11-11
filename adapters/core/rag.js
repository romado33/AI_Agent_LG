import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromaDir = path.resolve(__dirname, "..", "data", "chroma");

let vectorStore = null;
let embeddings = null;
let ragEnabled = false;

export async function initializeRAG() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not set - RAG disabled");
    return;
  }
  try {
    embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    await fs.mkdir(chromaDir, { recursive: true });
    // Try to connect to ChromaDB (defaults to localhost:8000)
    // If ChromaDB is not running, we'll disable RAG gracefully
    vectorStore = await Chroma.fromExistingCollection(embeddings, {
      collectionName: "resumes_jobs",
      url: process.env.CHROMA_URL || "http://localhost:8000",
    }).catch(async () => {
      // If collection doesn't exist, try to create it
      try {
        return await Chroma.fromDocuments([], embeddings, {
          collectionName: "resumes_jobs",
          url: process.env.CHROMA_URL || "http://localhost:8000",
        });
      } catch (error) {
        console.warn("ChromaDB not available - RAG disabled:", error.message);
        return null;
      }
    });
    ragEnabled = vectorStore !== null;
  } catch (error) {
    console.warn("RAG initialization failed:", error.message);
    ragEnabled = false;
  }
}

export async function addResumeToRAG(sid, resumeText) {
  if (!ragEnabled || !vectorStore) {
    return { warning: "RAG not available" };
  }
  try {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.createDocuments([resumeText], [
      { sid, type: "resume" },
    ]);
    await vectorStore.addDocuments(chunks);
    return { success: true, chunks: chunks.length };
  } catch (error) {
    console.error("Failed to add resume to RAG:", error);
    return { error: error.message };
  }
}

export async function addJobToRAG(jobData) {
  if (!ragEnabled || !vectorStore) {
    return { warning: "RAG not available" };
  }
  try {
    const jobText = `Company: ${jobData.company}\nRole: ${jobData.role}\nDescription: ${jobData.description || ""}\nRequirements: ${jobData.requirements || ""}\nStatus: ${jobData.status}`;
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.createDocuments([jobText], [
      { jobId: jobData.id, type: "job" },
    ]);
    await vectorStore.addDocuments(chunks);
    return { success: true, chunks: chunks.length };
  } catch (error) {
    console.error("Failed to add job to RAG:", error);
    return { error: error.message };
  }
}

export async function searchRAG(query, filter = {}) {
  if (!ragEnabled || !vectorStore) {
    return [];
  }
  try {
    const results = await vectorStore.similaritySearchWithScore(query, 5, filter);
    return results.map(([doc, score]) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
      score,
    }));
  } catch (error) {
    console.error("RAG search failed:", error);
    return [];
  }
}

export async function matchResumeToJobs(sid, limit = 5) {
  const { readResume } = await import("./storage.js");
  const resumeText = await readResume(sid);
  if (!resumeText) {
    return [];
  }
  const results = await searchRAG(resumeText, { type: "job" });
  return results.slice(0, limit);
}

export async function findRelevantResumeSections(sid, query) {
  const { readResume } = await import("./storage.js");
  const resumeText = await readResume(sid);
  if (!resumeText) {
    return [];
  }
  const results = await searchRAG(query, { sid, type: "resume" });
  return results;
}

