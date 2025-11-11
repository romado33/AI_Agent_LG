import { z } from "zod";
import { readJson, writeJson, newId, readResume } from "./storage.js";
import { scanJobs, scanSubscriptions } from "./scannerClient.js";

/* -------------------- Weather helpers (Open-Meteo, cached) -------------------- */
const _wCache = new Map(); // key -> {expires, data}
function _cached(key, ttlMs, fn) {
  const hit = _wCache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) {
    return hit.data;
  }
  return Promise.resolve()
    .then(fn)
    .then((data) => {
      _wCache.set(key, { expires: now + ttlMs, data });
      return data;
    });
}
async function geocode(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Geocoding failed: ${r.status}`);
  }
  const j = await r.json();
  const loc = j?.results?.[0];
  if (!loc) {
    throw new Error(`Could not find location: ${name}`);
  }
  return {
    name: `${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}${loc.country ? ", " + loc.country : ""}`,
    lat: loc.latitude,
    lon: loc.longitude,
    tz: loc.timezone,
  };
}
const geocodeCached = (q) => _cached("geo:" + q.toLowerCase(), 10 * 60 * 1000, () => geocode(q));

async function fetchForecast({ lat, lon, tz }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", tz);
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,snowfall,weather_code,wind_speed_10m,wind_gusts_10m"
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,wind_speed_10m_max"
  );
  url.searchParams.set("forecast_days", "7");
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Forecast failed: ${r.status}`);
  }
  return await r.json();
}
const forecastCached = (loc) =>
  _cached(`fc:${loc.lat},${loc.lon}`, 10 * 60 * 1000, () => fetchForecast(loc));

function pickHourIndex(hourly, localISO) {
  if (!localISO || !hourly?.time?.length) {
    return -1;
  }
  const target = localISO.slice(0, 13);
  return hourly.time.findIndex((t) => t.startsWith(target));
}

/* -------------------- Jobs -------------------- */
export function toolsJobs(factory) {
  const addJob = factory({
    name: "addJob",
    description: "Add a job to the local tracker.",
    schema: z.object({
      company: z.string(),
      role: z.string(),
      url: z.string().url().optional(),
      source: z.string().optional(),
      status: z.enum(["wishlist", "applied", "interview", "offer", "rejected"]).optional(),
      notes: z.string().optional(),
    }),
    impl: async (a) => {
      const rows = await readJson("jobs");
      const row = {
        id: newId("J"),
        created_at: new Date().toISOString(),
        company: a.company,
        role: a.role,
        url: a.url || "",
        source: a.source || "",
        status: a.status || "wishlist",
        notes: a.notes || "",
      };
      rows.push(row);
      await writeJson("jobs", rows);
      return { created: true, job: row };
    },
  });

  const listJobs = factory({
    name: "listJobs",
    description: "List jobs, optionally filtered by status.",
    schema: z.object({
      status: z.enum(["wishlist", "applied", "interview", "offer", "rejected"]).optional(),
    }),
    impl: async ({ status }) => {
      const rows = await readJson("jobs");
      const out = status ? rows.filter((r) => r.status === status) : rows;
      return { total: out.length, jobs: out.slice(0, 100) };
    },
  });

  const updateJob = factory({
    name: "updateJob",
    description: "Update a job by id.",
    schema: z.object({
      id: z.string(),
      status: z.enum(["wishlist", "applied", "interview", "offer", "rejected"]).optional(),
      notes: z.string().optional(),
    }),
    impl: async ({ id, status, notes }) => {
      const rows = await readJson("jobs");
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) {
        return { updated: false, message: `Not found: ${id}` };
      }
      if (status) {
        rows[i].status = status;
      }
      if (notes) {
        rows[i].notes = notes;
      }
      rows[i].updated_at = new Date().toISOString();
      await writeJson("jobs", rows);
      return { updated: true, job: rows[i] };
    },
  });

  const importJobsFromGmail = factory({
    name: "importJobsFromGmail",
    description: "Scan Gmail (local Python service) and merge into jobs.",
    schema: z.object({}),
    impl: async () => {
      const scanned = await scanJobs(); // { "Company|Role": {...} }
      const rows = await readJson("jobs");
      const index = new Map(rows.map((r) => [`${r.company}|${r.role}`, r]));
      let upserts = 0;
      for (const key of Object.keys(scanned || {})) {
        const it = scanned[key] || {};
        const company = it.company || key.split("|")[0] || "Unknown";
        const role = it.job_title || key.split("|")[1] || "Unknown";
        const ex = index.get(`${company}|${role}`);
        if (ex) {
          ex.status = it.status || ex.status;
          ex.last_update = it.last_update || ex.last_update;
          ex.updated_at = new Date().toISOString();
        } else {
          rows.push({
            id: newId("J"),
            created_at: new Date().toISOString(),
            company,
            role,
            url: "",
            source: "Gmail",
            status: it.status || "applied",
            notes: it.subject || "",
            last_update: it.last_update || "",
          });
          upserts++;
        }
      }
      await writeJson("jobs", rows);
      return { imported: true, upserts, total: rows.length };
    },
  });

  return { addJob, listJobs, updateJob, importJobsFromGmail };
}

/* -------------------- Subscriptions -------------------- */
export function toolsSubs(factory) {
  const addSubscription = factory({
    name: "addSubscription",
    description: "Add a subscription/free trial.",
    schema: z.object({
      service: z.string(),
      status: z.enum(["trial", "active", "canceled"]).default("active"),
      price: z.string().optional(),
      renewal_or_end: z.string().optional(),
      notes: z.string().optional(),
    }),
    impl: async (a) => {
      const rows = await readJson("subs");
      const row = {
        id: newId("S"),
        created_at: new Date().toISOString(),
        service: a.service,
        status: a.status || "active",
        price: a.price || "",
        renewal_or_end: a.renewal_or_end || "",
        notes: a.notes || "",
      };
      rows.push(row);
      await writeJson("subs", rows);
      return { created: true, subscription: row };
    },
  });

  const listSubscriptions = factory({
    name: "listSubscriptions",
    description: "List subscriptions (optional by status).",
    schema: z.object({ status: z.enum(["trial", "active", "canceled"]).optional() }),
    impl: async ({ status }) => {
      const rows = await readJson("subs");
      const out = status ? rows.filter((r) => r.status === status) : rows;
      return { total: out.length, subscriptions: out.slice(0, 200) };
    },
  });

  const updateSubscription = factory({
    name: "updateSubscription",
    description: "Update a subscription by id.",
    schema: z.object({
      id: z.string(),
      status: z.enum(["trial", "active", "canceled"]).optional(),
      notes: z.string().optional(),
      renewal_or_end: z.string().optional(),
      price: z.string().optional(),
    }),
    impl: async ({ id, status, notes, renewal_or_end, price }) => {
      const rows = await readJson("subs");
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) {
        return { updated: false, message: `Not found: ${id}` };
      }
      if (status) {
        rows[i].status = status;
      }
      if (notes) {
        rows[i].notes = notes;
      }
      if (renewal_or_end) {
        rows[i].renewal_or_end = renewal_or_end;
      }
      if (price) {
        rows[i].price = price;
      }
      rows[i].updated_at = new Date().toISOString();
      await writeJson("subs", rows);
      return { updated: true, subscription: rows[i] };
    },
  });

  const importSubscriptionsFromGmail = factory({
    name: "importSubscriptionsFromGmail",
    description: "Scan Gmail (local Python service) and merge into subscriptions.",
    schema: z.object({}),
    impl: async () => {
      const scanned = await scanSubscriptions(); // { items:[...] }
      const items = scanned.items || [];
      const rows = await readJson("subs");
      const index = new Map(rows.map((r) => [`${r.service}|${r.renewal_or_end}|${r.price}`, r]));
      let upserts = 0;
      for (const it of items) {
        const key = `${(it.service || "Unknown").toLowerCase()}|${it.renewal_or_end || ""}|${it.price || ""}`;
        if (index.has(key)) {
          continue;
        }
        rows.push({
          id: newId("S"),
          created_at: new Date().toISOString(),
          service: it.service || "Unknown",
          status: it.status || "active",
          price: it.price || "",
          renewal_or_end: it.renewal_or_end || "",
          notes: it.subject || "",
        });
        index.set(key, true);
        upserts++;
      }
      await writeJson("subs", rows);
      return { imported: true, upserts, total: rows.length };
    },
  });

  return { addSubscription, listSubscriptions, updateSubscription, importSubscriptionsFromGmail };
}

/* -------------------- Weather tools -------------------- */
export function toolsWeather(factory) {
  const getWeather = factory({
    name: "getWeather",
    description:
      "Get current/forecast weather for a location. Optional 'when' like 'today 6pm' or 'tomorrow morning'.",
    schema: z.object({ location: z.string(), when: z.string().optional() }),
    impl: async ({ location, when }) => {
      const place = await geocodeCached(location);
      const fc = await forecastCached(place);
      let hourIndex = -1;
      if (when) {
        const m1 = /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(when);
        const m2 = /\b(\d{1,2}):(\d{2})\b/.exec(when);
        let hh = null,
          mm = "00";
        if (m1) {
          hh = parseInt(m1[1], 10);
          mm = m1[2] || "00";
          const ap = m1[3].toLowerCase();
          if (ap === "pm" && hh !== 12) {
            hh += 12;
          }
          if (ap === "am" && hh === 12) {
            hh = 0;
          }
        } else if (m2) {
          hh = parseInt(m2[1], 10);
          mm = m2[2];
        }
        if (hh !== null) {
          const now = new Date();
          const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${mm}`;
          hourIndex = pickHourIndex(fc.hourly, iso);
        }
      }
      return {
        location: place.name,
        timezone: place.tz,
        current: fc.current || null,
        hourly: {
          time: fc.hourly?.time || [],
          temperature_2m: fc.hourly?.temperature_2m || [],
          apparent_temperature: fc.hourly?.apparent_temperature || [],
          precipitation_probability: fc.hourly?.precipitation_probability || [],
          precipitation: fc.hourly?.precipitation || [],
          rain: fc.hourly?.rain || [],
          snowfall: fc.hourly?.snowfall || [],
          wind_speed_10m: fc.hourly?.wind_speed_10m || [],
          wind_gusts_10m: fc.hourly?.wind_gusts_10m || [],
          suggested_hour_index: hourIndex,
        },
        daily: fc.daily || null,
        note: "Use 'suggested_hour_index' if >= 0; otherwise infer best hour(s) from hourly arrays.",
      };
    },
  });
  return { getWeather };
}

/* -------------------- Sentiment (FeelMapper) -------------------- */
export function toolsSentiment(factory) {
  const POS = new Set([
    "good",
    "great",
    "excellent",
    "love",
    "happy",
    "amazing",
    "fantastic",
    "positive",
    "wonderful",
    "awesome",
  ]);
  const NEG = new Set([
    "bad",
    "terrible",
    "awful",
    "hate",
    "sad",
    "poor",
    "horrible",
    "negative",
    "angry",
    "disappointing",
  ]);

  function score(text) {
    const toks = (text || "").toLowerCase().match(/[a-z']+/g) || [];
    let s = 0;
    for (const t of toks) {
      if (POS.has(t)) {
        s++;
      }
      if (NEG.has(t)) {
        s--;
      }
    }
    const label = s > 1 ? "positive" : s < -1 ? "negative" : "neutral";
    return { label, score: s, tokens: toks.length };
  }

  const analyzeSentiment = factory({
    name: "analyzeSentiment",
    description: "Analyze sentiment of a body of text; returns label, score, and key phrases.",
    schema: z.object({ text: z.string().min(1) }),
    impl: async ({ text }) => {
      const { label, score: sentimentScore } = score(text);
      const freq = Object.create(null);
      for (const w of text.toLowerCase().match(/[a-z]{5,}/g) || []) {
        freq[w] = (freq[w] || 0) + 1;
      }
      const phrases = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w, c]) => ({ phrase: w, count: c }));
      return { label, score: sentimentScore, phrases, chars: text.length };
    },
  });
  return { analyzeSentiment };
}

/* -------------------- Résumé tools -------------------- */
export function toolsResume(factory, getContext) {
  function chunk(text, size = 1200) {
    const out = [];
    for (let i = 0; i < text.length; i += size) {
      out.push(text.slice(i, i + size));
    }
    return out;
  }
  function topSnippets(text, question, k = 3) {
    const chunks = chunk(text);
    const q = (question || "").toLowerCase().match(/[a-z]{3,}/g) || [];
    const scores = chunks.map((c, i) => {
      let s = 0;
      const lc = c.toLowerCase();
      for (const term of q) {
        if (lc.includes(term)) {
          s++;
        }
      }
      return { i, s, text: c };
    });
    return scores
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => ({ index: x.i, score: x.s, text: x.text }));
  }

  const resumeStatus = factory({
    name: "resumeStatus",
    description: "Return whether a résumé is uploaded for this session.",
    schema: z.object({}),
    impl: async () => {
      const { sid } = getContext();
      const text = await readResume(sid);
      return { has_resume: !!text, chars: text.length };
    },
  });
  const resumeAsk = factory({
    name: "resumeAsk",
    description: "Retrieve the most relevant résumé snippets for a question.",
    schema: z.object({ question: z.string().min(1) }),
    impl: async ({ question }) => {
      const { sid } = getContext();
      const text = await readResume(sid);
      if (!text) {
        return { has_resume: false, message: "No resume uploaded for this session." };
      }
      const snippets = topSnippets(text, question, 4);
      return { has_resume: true, snippets, note: "Answer strictly from these snippets." };
    },
  });
  const resumeImprove = factory({
    name: "resumeImprove",
    description:
      "Provide top snippets for improvement suggestions (skills, impact metrics, clarity).",
    schema: z.object({ focus: z.string().optional() }),
    impl: async ({ focus }) => {
      const { sid } = getContext();
      const text = await readResume(sid);
      if (!text) {
        return { has_resume: false, message: "No resume uploaded for this session." };
      }
      const snippets = topSnippets(text, focus || "experience results impact clarity", 6);
      return {
        has_resume: true,
        snippets,
        note: "Suggest concrete edits with examples and metrics.",
      };
    },
  });

  return { resumeStatus, resumeAsk, resumeImprove };
}
