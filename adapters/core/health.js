import { z } from "zod";
import { getUserMemory, updatePreference, addFact } from "./memory.js";

export function toolsHealth(factory, getContext) {
  const trackWorkLifeBalance = factory({
    name: "trackWorkLifeBalance",
    description: "Track and analyze work-life balance based on activity",
    schema: z.object({
      workHours: z.number().optional(),
      breakTime: z.number().optional(),
      stressLevel: z.number().min(1).max(10).optional(),
    }),
    impl: async ({ workHours, breakTime, stressLevel }) => {
      const { sid } = getContext();
      const memory = await getUserMemory(sid);
      const health = memory.context.health || {};

      if (workHours !== undefined) {
        health.workHours = workHours;
      }
      if (breakTime !== undefined) {
        health.breakTime = breakTime;
      }
      if (stressLevel !== undefined) {
        health.stressLevel = stressLevel;
      }

      const analysis = analyzeWorkLifeBalance(health);
      await updatePreference(sid, "health", health);
      await addFact(sid, `Work-life balance tracked: ${analysis.recommendation}`);

      return {
        current: health,
        analysis,
        recommendations: generateHealthRecommendations(analysis),
      };
    },
  });

  const suggestBreaks = factory({
    name: "suggestBreaks",
    description: "Suggest break times based on work patterns",
    schema: z.object({}),
    impl: async () => {
      const { sid } = getContext();
      const memory = await getUserMemory(sid);
      const health = memory.context.health || {};
      const workHours = health.workHours || 8;

      const suggestions = [];
      if (workHours > 6) {
        suggestions.push({
          time: "After 2 hours",
          activity: "Take a 15-minute break",
          reason: "Prevent eye strain and maintain focus",
        });
      }
      if (workHours > 4) {
        suggestions.push({
          time: "Lunch time",
          activity: "Take a 30-minute break",
          reason: "Recharge for afternoon work",
        });
      }
      if (workHours > 8) {
        suggestions.push({
          time: "End of day",
          activity: "Consider shorter work day",
          reason: "Maintain work-life balance",
        });
      }

      return {
        suggestions,
        workHours,
        note: "Based on your current work patterns",
      };
    },
  });

  const trackProductivity = factory({
    name: "trackProductivity",
    description: "Track productivity metrics and provide insights",
    schema: z.object({
      tasksCompleted: z.number(),
      focusTime: z.number().optional(),
    }),
    impl: async ({ tasksCompleted, focusTime }) => {
      const { sid } = getContext();
      const memory = await getUserMemory(sid);
      const productivity = memory.context.productivity || {
        dailyTasks: [],
        weeklyAverage: 0,
      };

      const today = new Date().toISOString().split("T")[0];
      productivity.dailyTasks.push({
        date: today,
        tasksCompleted,
        focusTime: focusTime || 0,
      });

      // Keep last 30 days
      if (productivity.dailyTasks.length > 30) {
        productivity.dailyTasks = productivity.dailyTasks.slice(-30);
      }

      const weeklyAverage =
        productivity.dailyTasks
          .slice(-7)
          .reduce((sum, d) => sum + d.tasksCompleted, 0) / 7;

      productivity.weeklyAverage = weeklyAverage;

      await updatePreference(sid, "productivity", productivity);

      return {
        today: { tasksCompleted, focusTime },
        weeklyAverage: weeklyAverage.toFixed(1),
        trend: analyzeProductivityTrend(productivity.dailyTasks),
        recommendations: generateProductivityRecommendations(weeklyAverage),
      };
    },
  });

  return { trackWorkLifeBalance, suggestBreaks, trackProductivity };
}

function analyzeWorkLifeBalance(health) {
  const workHours = health.workHours || 0;
  const breakTime = health.breakTime || 0;
  const stressLevel = health.stressLevel || 5;

  let score = 100;
  let recommendation = "Good balance";

  if (workHours > 10) {
    score -= 30;
    recommendation = "Working too many hours - consider reducing";
  } else if (workHours > 8) {
    score -= 15;
    recommendation = "Slightly overworked - take more breaks";
  }

  if (breakTime < workHours * 0.1) {
    score -= 20;
    recommendation = "Not enough break time - take regular breaks";
  }

  if (stressLevel > 7) {
    score -= 25;
    recommendation = "High stress level - prioritize self-care";
  }

  return {
    score: Math.max(0, score),
    recommendation,
    workHours,
    breakTime,
    stressLevel,
  };
}

function generateHealthRecommendations(analysis) {
  const recommendations = [];
  if (analysis.score < 50) {
    recommendations.push("Consider reducing work hours");
    recommendations.push("Schedule regular breaks");
    recommendations.push("Practice stress management techniques");
  } else if (analysis.score < 75) {
    recommendations.push("Take more frequent breaks");
    recommendations.push("Maintain current work schedule");
  } else {
    recommendations.push("Maintain good work-life balance");
  }
  return recommendations;
}

function analyzeProductivityTrend(dailyTasks) {
  if (dailyTasks.length < 2) {
    return "Insufficient data";
  }
  const recent = dailyTasks.slice(-7);
  const older = dailyTasks.slice(-14, -7);
  if (older.length === 0) {
    return "Insufficient data";
  }
  const recentAvg =
    recent.reduce((sum, d) => sum + d.tasksCompleted, 0) / recent.length;
  const olderAvg =
    older.reduce((sum, d) => sum + d.tasksCompleted, 0) / older.length;
  if (recentAvg > olderAvg * 1.1) {
    return "Improving";
  }
  if (recentAvg < olderAvg * 0.9) {
    return "Declining";
  }
  return "Stable";
}

function generateProductivityRecommendations(weeklyAverage) {
  const recommendations = [];
  if (weeklyAverage < 3) {
    recommendations.push("Consider breaking tasks into smaller chunks");
    recommendations.push("Focus on high-priority tasks first");
  } else if (weeklyAverage > 10) {
    recommendations.push("Great productivity! Maintain this pace");
    recommendations.push("Don't forget to take breaks");
  } else {
    recommendations.push("Good productivity level");
    recommendations.push("Continue tracking to identify patterns");
  }
  return recommendations;
}

