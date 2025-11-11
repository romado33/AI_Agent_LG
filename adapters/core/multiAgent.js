import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { readJson, writeJson, newId } from "./storage.js";
import { scanJobs } from "./scannerClient.js";
import { matchResumeToJobs, findRelevantResumeSections } from "./rag.js";
import { getUserMemory, updatePreference, addFact } from "./memory.js";

// Job Researcher Agent - Finds and analyzes job opportunities
export function createResearcherAgent(factory, getContext) {
  const searchJobs = factory({
    name: "searchJobs",
    description: "Search for job opportunities based on criteria",
    schema: z.object({
      keywords: z.string(),
      location: z.string().optional(),
      remote: z.boolean().optional(),
      experienceLevel: z.enum(["entry", "mid", "senior"]).optional(),
    }),
    impl: async ({ keywords, location, remote, experienceLevel }) => {
      const scanned = await scanJobs();
      const jobs = Object.values(scanned || {});
      let filtered = jobs;

      if (keywords) {
        const kw = keywords.toLowerCase();
        filtered = filtered.filter(
          (j) =>
            j.company?.toLowerCase().includes(kw) ||
            j.job_title?.toLowerCase().includes(kw) ||
            j.subject?.toLowerCase().includes(kw)
        );
      }

      return {
        found: filtered.length,
        jobs: filtered.slice(0, 20),
      };
    },
  });

  const researchCompany = factory({
    name: "researchCompany",
    description: "Research a company for job applications",
    schema: z.object({
      company: z.string(),
    }),
    impl: async ({ company }) => {
      // In a real implementation, this would use web scraping or APIs
      // For now, return structured data
      return {
        company,
        info: `Research data for ${company} would be fetched here`,
        note: "Implement web scraping or use company APIs",
      };
    },
  });

  return { searchJobs, researchCompany };
}

// Job Matcher Agent - Matches resume to job descriptions
export function createMatcherAgent(factory, getContext) {
  const matchResume = factory({
    name: "matchResume",
    description: "Match user's resume to job opportunities",
    schema: z.object({
      jobId: z.string().optional(),
      limit: z.number().default(5),
    }),
    impl: async ({ jobId, limit }) => {
      const { sid } = getContext();
      if (jobId) {
        // Match specific job
        const sections = await findRelevantResumeSections(sid, jobId);
        return { matches: sections, jobId };
      }
      // Find best matching jobs
      const matches = await matchResumeToJobs(sid, limit);
      return { matches, count: matches.length };
    },
  });

  const analyzeFit = factory({
    name: "analyzeFit",
    description: "Analyze how well resume fits a job description",
    schema: z.object({
      jobDescription: z.string(),
      jobRequirements: z.string().optional(),
    }),
    impl: async ({ jobDescription, jobRequirements }) => {
      const { sid } = getContext();
      const sections = await findRelevantResumeSections(
        sid,
        jobDescription + " " + (jobRequirements || "")
      );
      const matchScore = sections.length > 0 ? sections[0].score : 0;
      return {
        matchScore: Math.round(matchScore * 100),
        relevantSections: sections.slice(0, 3),
        recommendation:
          matchScore > 0.7
            ? "Strong match - apply!"
            : matchScore > 0.5
            ? "Moderate match - consider applying"
            : "Weak match - may need resume updates",
      };
    },
  });

  return { matchResume, analyzeFit };
}

// Application Writer Agent - Helps write cover letters and applications
export function createWriterAgent(factory, getContext) {
  const generateCoverLetter = factory({
    name: "generateCoverLetter",
    description: "Generate a personalized cover letter for a job application",
    schema: z.object({
      jobId: z.string(),
      tone: z.enum(["professional", "casual", "enthusiastic"]).default("professional"),
      length: z.enum(["short", "medium", "long"]).default("medium"),
    }),
    impl: async ({ jobId, tone, length }) => {
      const { sid } = getContext();
      const memory = await getUserMemory(sid);
      const jobs = await readJson("jobs");
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        return { error: "Job not found" };
      }
      // In real implementation, use LLM to generate cover letter
      return {
        coverLetter: `[Generated cover letter for ${job.company} - ${job.role}]`,
        jobId,
        tone,
        length,
        note: "Implement LLM-based generation",
      };
    },
  });

  const improveResume = factory({
    name: "improveResume",
    description: "Suggest improvements to resume for specific job",
    schema: z.object({
      jobId: z.string(),
    }),
    impl: async ({ jobId }) => {
      const { sid } = getContext();
      const jobs = await readJson("jobs");
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        return { error: "Job not found" };
      }
      const sections = await findRelevantResumeSections(sid, job.role);
      return {
        suggestions: [
          "Highlight relevant experience",
          "Add keywords from job description",
          "Quantify achievements",
        ],
        jobId,
        relevantSections: sections.slice(0, 3),
      };
    },
  });

  return { generateCoverLetter, improveResume };
}

// Multi-agent coordinator
export function createMultiAgentTeam(factory, getContext) {
  const researcher = createResearcherAgent(factory, getContext);
  const matcher = createMatcherAgent(factory, getContext);
  const writer = createWriterAgent(factory, getContext);

  const fullJobSearch = factory({
    name: "fullJobSearch",
    description: "Complete job search workflow: research, match, and prepare application",
    schema: z.object({
      keywords: z.string(),
      location: z.string().optional(),
    }),
    impl: async ({ keywords, location }) => {
      // Step 1: Research
      const research = await researcher.searchJobs.invoke({ keywords, location });
      // Step 2: Match
      const matches = await matcher.matchResume.invoke({ limit: 5 });
      // Step 3: Return combined results
      return {
        researchResults: research,
        topMatches: matches,
        nextSteps: [
          "Review matched jobs",
          "Generate cover letters",
          "Track applications",
        ],
      };
    },
  });

  return {
    ...researcher,
    ...matcher,
    ...writer,
    fullJobSearch,
  };
}

