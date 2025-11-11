import { z } from "zod";
import { readJson } from "./storage.js";
import { getUserMemory } from "./memory.js";

export function toolsFinancial(factory, getContext) {
  const analyzeSubscriptions = factory({
    name: "analyzeSubscriptions",
    description: "Analyze subscription spending and provide recommendations",
    schema: z.object({}),
    impl: async () => {
      const rows = await readJson("subs");
      const active = rows.filter((r) => r.status === "active");
      const totalMonthly = active.reduce((sum, r) => {
        const price = parseFloat(r.price?.replace(/[^0-9.]/g, "") || "0");
        return sum + price;
      }, 0);
      const totalYearly = totalMonthly * 12;

      const categories = {};
      active.forEach((r) => {
        const category =
          r.service?.toLowerCase().includes("netflix") ||
          r.service?.toLowerCase().includes("hulu") ||
          r.service?.toLowerCase().includes("disney")
            ? "Entertainment"
            : r.service?.toLowerCase().includes("spotify") ||
              r.service?.toLowerCase().includes("apple music")
            ? "Music"
            : r.service?.toLowerCase().includes("adobe") ||
              r.service?.toLowerCase().includes("figma")
            ? "Software"
            : r.service?.toLowerCase().includes("aws") ||
              r.service?.toLowerCase().includes("cloud")
            ? "Cloud Services"
            : "Other";

        categories[category] = (categories[category] || 0) + parseFloat(r.price?.replace(/[^0-9.]/g, "") || "0");
      });

      const recommendations = [];
      if (totalMonthly > 100) {
        recommendations.push("Consider reviewing subscriptions - you're spending over $100/month");
      }
      if (categories["Entertainment"] > 50) {
        recommendations.push("Multiple entertainment subscriptions detected - consider consolidating");
      }

      return {
        totalMonthly: totalMonthly.toFixed(2),
        totalYearly: totalYearly.toFixed(2),
        activeCount: active.length,
        categories,
        recommendations,
        subscriptions: active,
      };
    },
  });

  const optimizeSubscriptions = factory({
    name: "optimizeSubscriptions",
    description: "Suggest subscription optimizations to save money",
    schema: z.object({}),
    impl: async () => {
      const rows = await readJson("subs");
      const active = rows.filter((r) => r.status === "active");
      const suggestions = [];

      // Find duplicates or similar services
      const services = active.map((r) => r.service?.toLowerCase() || "");
      const duplicates = services.filter(
        (s, i) => services.indexOf(s) !== i
      );

      if (duplicates.length > 0) {
        suggestions.push({
          type: "duplicate",
          message: "Found potential duplicate subscriptions",
          services: duplicates,
        });
      }

      // Find unused subscriptions
      const unused = active.filter((r) => {
        const lastUpdate = r.last_update || r.updated_at || r.created_at;
        const daysSinceUpdate =
          (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceUpdate > 90;
      });

      if (unused.length > 0) {
        suggestions.push({
          type: "unused",
          message: "Subscriptions not used in 90+ days",
          subscriptions: unused.map((r) => ({
            service: r.service,
            price: r.price,
            lastUpdate: r.last_update || r.updated_at,
          })),
        });
      }

      return {
        suggestions,
        potentialSavings: suggestions.reduce((sum, s) => {
          if (s.type === "unused") {
            return (
              sum +
              s.subscriptions.reduce(
                (subSum, sub) =>
                  subSum + parseFloat(sub.price?.replace(/[^0-9.]/g, "") || "0"),
                0
              )
            );
          }
          return sum;
        }, 0),
      };
    },
  });

  const trackROI = factory({
    name: "trackROI",
    description: "Track return on investment for subscriptions",
    schema: z.object({
      subscriptionId: z.string(),
      value: z.number().describe("Value received from subscription"),
    }),
    impl: async ({ subscriptionId, value }) => {
      const rows = await readJson("subs");
      const sub = rows.find((r) => r.id === subscriptionId);
      if (!sub) {
        return { error: "Subscription not found" };
      }
      const cost = parseFloat(sub.price?.replace(/[^0-9.]/g, "") || "0");
      const roi = cost > 0 ? ((value - cost) / cost) * 100 : 0;
      return {
        subscription: sub.service,
        cost,
        value,
        roi: roi.toFixed(2) + "%",
        recommendation:
          roi > 100
            ? "Excellent ROI - keep subscription"
            : roi > 0
            ? "Positive ROI - consider value"
            : "Negative ROI - consider canceling",
      };
    },
  });

  return { analyzeSubscriptions, optimizeSubscriptions, trackROI };
}

