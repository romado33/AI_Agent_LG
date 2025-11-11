import { pino } from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export class AgentCallbacks {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.events = [];
  }

  onToolStart(toolName, input) {
    const event = {
      type: "tool_start",
      tool: toolName,
      input,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    logger.info({ sessionId: this.sessionId, ...event }, "Tool started");
  }

  onToolEnd(toolName, output) {
    const event = {
      type: "tool_end",
      tool: toolName,
      output,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    logger.info({ sessionId: this.sessionId, ...event }, "Tool completed");
  }

  onLLMStart(prompt) {
    const event = {
      type: "llm_start",
      promptLength: prompt.length,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    logger.debug({ sessionId: this.sessionId, ...event }, "LLM call started");
  }

  onLLMEnd(response) {
    const event = {
      type: "llm_end",
      responseLength: response?.length || 0,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    logger.debug({ sessionId: this.sessionId, ...event }, "LLM call completed");
  }

  onError(error, context) {
    const event = {
      type: "error",
      error: error.message,
      context,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    logger.error({ sessionId: this.sessionId, ...event }, "Agent error");
  }

  getEvents() {
    return this.events;
  }

  getToolUsage() {
    const toolStarts = this.events.filter((e) => e.type === "tool_start");
    const usage = {};
    toolStarts.forEach((e) => {
      usage[e.tool] = (usage[e.tool] || 0) + 1;
    });
    return usage;
  }
}

export function createCallbacks(sessionId) {
  return new AgentCallbacks(sessionId);
}

