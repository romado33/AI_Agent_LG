import { z } from "zod";
import { getUserMemory, addFact, updateContext } from "./memory.js";

export function toolsMeeting(factory, getContext) {
  const summarizeMeeting = factory({
    name: "summarizeMeeting",
    description: "Summarize a meeting transcript or notes",
    schema: z.object({
      transcript: z.string(),
      meetingType: z.enum(["interview", "standup", "one-on-one", "other"]).default("other"),
    }),
    impl: async ({ transcript, meetingType }) => {
      const { sid } = getContext();
      // In real implementation, use LLM to summarize
      const summary = {
        type: meetingType,
        keyPoints: extractKeyPoints(transcript),
        actionItems: extractActionItems(transcript),
        participants: extractParticipants(transcript),
        duration: estimateDuration(transcript),
        sentiment: analyzeSentiment(transcript),
      };

      // Store in memory
      await addFact(sid, `Meeting summary: ${meetingType} - ${summary.keyPoints.length} key points`);
      await updateContext(sid, `lastMeeting_${meetingType}`, summary);

      return summary;
    },
  });

  const extractInterviewInsights = factory({
    name: "extractInterviewInsights",
    description: "Extract insights from an interview transcript",
    schema: z.object({
      transcript: z.string(),
      role: z.string().optional(),
      company: z.string().optional(),
    }),
    impl: async ({ transcript, role, company }) => {
      const { sid } = getContext();
      const insights = {
        questions: extractQuestions(transcript),
        topics: extractTopics(transcript),
        nextSteps: extractNextSteps(transcript),
        feedback: analyzeFeedback(transcript),
        role: role || "Unknown",
        company: company || "Unknown",
      };

      await addFact(sid, `Interview insights: ${company} - ${role}`);
      return insights;
    },
  });

  const createFollowUp = factory({
    name: "createFollowUp",
    description: "Create a follow-up email based on meeting notes",
    schema: z.object({
      meetingType: z.enum(["interview", "standup", "one-on-one", "other"]),
      tone: z.enum(["professional", "casual", "enthusiastic"]).default("professional"),
    }),
    impl: async ({ meetingType, tone }) => {
      const { sid } = getContext();
      const memory = await getUserMemory(sid);
      const lastMeeting = memory.context[`lastMeeting_${meetingType}`];

      if (!lastMeeting) {
        return { error: "No recent meeting found" };
      }

      return {
        email: generateFollowUpEmail(lastMeeting, tone),
        meetingType,
        tone,
      };
    },
  });

  return { summarizeMeeting, extractInterviewInsights, createFollowUp };
}

function extractKeyPoints(text) {
  const sentences = text.split(/[.!?]+/);
  return sentences
    .filter((s) => s.trim().length > 20)
    .slice(0, 5)
    .map((s) => s.trim());
}

function extractActionItems(text) {
  const actionItems = [];
  const lines = text.split("\n");
  lines.forEach((line) => {
    if (
      line.toLowerCase().includes("action") ||
      line.toLowerCase().includes("todo") ||
      line.toLowerCase().includes("follow up") ||
      line.match(/^\s*[-*]\s/i)
    ) {
      actionItems.push(line.trim());
    }
  });
  return actionItems.slice(0, 10);
}

function extractParticipants(text) {
  const names = [];
  // Simple extraction - in real implementation, use NER
  const namePatterns = [
    /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g,
    /\b([A-Z][a-z]+)\b/g,
  ];
  namePatterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      names.push(...matches.slice(0, 10));
    }
  });
  return [...new Set(names)];
}

function estimateDuration(text) {
  const wordCount = text.split(/\s+/).length;
  const wordsPerMinute = 150;
  return Math.ceil(wordCount / wordsPerMinute);
}

function analyzeSentiment(text) {
  const positive = ["great", "excellent", "good", "awesome", "thanks"].filter((w) =>
    text.toLowerCase().includes(w)
  ).length;
  const negative = ["bad", "problem", "issue", "concern", "worried"].filter((w) =>
    text.toLowerCase().includes(w)
  ).length;
  if (positive > negative) {
    return "positive";
  }
  if (negative > positive) {
    return "negative";
  }
  return "neutral";
}

function extractQuestions(text) {
  const questions = [];
  const lines = text.split("\n");
  lines.forEach((line) => {
    if (line.trim().endsWith("?") || line.toLowerCase().includes("question")) {
      questions.push(line.trim());
    }
  });
  return questions.slice(0, 10);
}

function extractTopics(text) {
  const topics = [];
  const commonTopics = [
    "salary",
    "benefits",
    "team",
    "project",
    "technology",
    "culture",
    "growth",
    "challenges",
  ];
  commonTopics.forEach((topic) => {
    if (text.toLowerCase().includes(topic)) {
      topics.push(topic);
    }
  });
  return topics;
}

function extractNextSteps(text) {
  const nextSteps = [];
  const patterns = [
    /next step[s]?:?\s*(.+)/i,
    /follow up:?\s*(.+)/i,
    /we'll\s+(.+)/i,
  ];
  patterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      nextSteps.push(matches[1].trim());
    }
  });
  return nextSteps;
}

function analyzeFeedback(text) {
  const feedback = {
    positive: [],
    areas: [],
  };
  const positiveIndicators = ["impressed", "strong", "excellent", "great fit"];
  const areaIndicators = ["consider", "think about", "improve", "develop"];

  positiveIndicators.forEach((indicator) => {
    if (text.toLowerCase().includes(indicator)) {
      feedback.positive.push(indicator);
    }
  });

  areaIndicators.forEach((indicator) => {
    if (text.toLowerCase().includes(indicator)) {
      feedback.areas.push(indicator);
    }
  });

  return feedback;
}

function generateFollowUpEmail(meeting, tone) {
  const greeting = tone === "casual" ? "Hi" : "Dear";
  return `${greeting} Team,

Thank you for the ${meeting.type} meeting. Here's a summary:

Key Points:
${meeting.keyPoints.map((p) => `- ${p}`).join("\n")}

Action Items:
${meeting.actionItems.map((a) => `- ${a}`).join("\n")}

Looking forward to our next steps.

Best regards`;
}

