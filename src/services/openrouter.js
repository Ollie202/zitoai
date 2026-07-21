import { config } from "../config.js";
import { normalizeBriefLocally } from "../core/brief.js";
import { fetchJson } from "../lib/http.js";

const PARSE_BRIEF_MODEL = "google/gemini-2.5-flash-lite";
const RANK_RESULTS_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const ASSET_TYPE_MAP = { image: "image", music: "music", sfx: "sound_effect" };
const SUPPORTED_ASSET_TYPES = new Set(["image", "music", "sound_effect"]);
const USAGE_RIGHTS = new Set(["personal", "commercial", "broadcast", "resale"]);

const openRouterUsage = {
  estimatedSpendUsd: 0,
  calls: [],
  events: [],
};

const PARSE_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    asset_type: { enum: ["image", "music", "sfx"] },
    usage_rights: { enum: ["personal", "commercial", "broadcast", "resale"] },
    source_language: { type: "string" },
    translated_query: { type: "string" },
    keywords: { type: "array", items: { type: "string" }, maxItems: 12 },
    mood: { type: ["string", "null"] },
    max_price: { type: ["number", "null"] },
    format_constraints: { type: ["string", "null"] },
  },
  required: ["asset_type", "usage_rights", "source_language", "translated_query", "keywords", "mood", "max_price", "format_constraints"],
  additionalProperties: false,
};

const RANK_RESULTS_SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          asset_id: { type: "string" },
          source: { type: "string" },
          reason: { type: "string" },
        },
        required: ["asset_id", "source", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranked"],
  additionalProperties: false,
};

export function brainStatus() {
  return {
    configured: Boolean(config.openRouter.apiKey),
    status: config.openRouter.apiKey ? "ready" : "fallback",
    fallbackAvailable: true,
    guardrails: {
      maxCallsPerMinute: config.openRouter.maxCallsPerMinute,
      maxInputChars: config.openRouter.maxInputChars,
    },
  };
}

export function internalBrainStatus() {
  return {
    configured: Boolean(config.openRouter.apiKey),
    model: PARSE_BRIEF_MODEL,
    fastModel: PARSE_BRIEF_MODEL,
    smartModel: RANK_RESULTS_MODEL,
    parseBriefModel: PARSE_BRIEF_MODEL,
    rankResultsModel: RANK_RESULTS_MODEL,
    fallback: "deterministic-local-parser",
    guardrails: openRouterGuardrailStatus(),
  };
}

export function openRouterGuardrailStatus() {
  return {
    estimatedSpendUsd: Number(openRouterUsage.estimatedSpendUsd.toFixed(8)),
    maxSpendUsd: config.openRouter.maxSpendUsd,
    maxCallsPerMinute: config.openRouter.maxCallsPerMinute,
    maxInputChars: config.openRouter.maxInputChars,
    recentCallsLastMinute: recentCallCount(),
    remainingEstimatedUsd: Number.isFinite(config.openRouter.maxSpendUsd)
      ? Number(Math.max(0, config.openRouter.maxSpendUsd - openRouterUsage.estimatedSpendUsd).toFixed(8))
      : null,
    recentEvents: openRouterUsage.events.slice(-10),
  };
}

export async function normalizeBrief(input) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const local = normalizeBriefLocally(request);
  if (!config.openRouter.apiKey) {
    return { brief: local, brain: { used: false, mode: "local" } };
  }

  const guard = canCallOpenRouter("parse_brief", JSON.stringify(request));
  if (!guard.ok) {
    logOpenRouterEvent({ functionName: "parse_brief", model: PARSE_BRIEF_MODEL, success: false, fallback: true, reason: guard.reason });
    return { brief: local, brain: { used: false, mode: "local-fallback", error: guard.reason, guardrails: openRouterGuardrailStatus() } };
  }

  try {
    const body = await requestStructuredJson({
      functionName: "parse_brief",
      model: PARSE_BRIEF_MODEL,
      schemaName: "zito_parse_brief",
      schema: PARSE_BRIEF_SCHEMA,
      maxTokens: 180,
      messages: [
        {
          role: "system",
          content:
            [
              "Extract a provider-ready media-search brief from any language.",
              "Support English, major world languages, Nigerian Pidgin, Yoruba, Igbo, Hausa, and mixed-language requests.",
              "Detect whether the user wants an image, music track, or sound effect/ambience.",
              "Set source_language to a short human-readable language label such as English, Yoruba, Nigerian Pidgin, Hausa, Igbo, Arabic, Japanese, or Mixed.",
              "Set translated_query to a concise English search query that a stock media API can understand.",
              "Return English keywords only. Keep the user's original wording out of translated_query unless it is already useful English.",
              "Do not decide licensing eligibility. Return only JSON that matches the schema.",
            ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            query: request.query || "",
            assetTypeHint: request.assetType || null,
            intendedUse: request.intendedUse || null,
            commercial: request.commercial ?? null,
            territory: request.territory || null,
          }).slice(0, config.openRouter.maxInputChars),
        },
      ],
    });
    return buildBriefResult(body, local, request);
  } catch (error) {
    logOpenRouterEvent({ functionName: "parse_brief", model: PARSE_BRIEF_MODEL, success: false, fallback: true, reason: error.message });
    return {
      brief: local,
      brain: {
        used: false,
        mode: "local-fallback",
        attemptedModels: [PARSE_BRIEF_MODEL],
        error: error.message,
        guardrails: openRouterGuardrailStatus(),
      },
    };
  }
}

export async function rankResultsWithOpenRouter(brief, results) {
  const candidates = Array.isArray(results) ? results : [];
  if (!config.openRouter.apiKey || candidates.length < 2) {
    return { results: candidates, ranking: { used: false, mode: config.openRouter.apiKey ? "not-needed" : "local" } };
  }

  const payload = JSON.stringify({
    brief: {
      asset_type: brief.assetType,
      query: brief.query,
      original_query: brief.originalQuery || brief.query,
      source_language: brief.sourceLanguage || null,
      intended_use: brief.intendedUse,
      commercial: brief.commercial,
      keywords: brief.keywords || [],
    },
    candidates: candidates.map((asset) => ({
      asset_id: String(asset.id),
      source: String(asset.provider),
      title: asset.title,
      creator: asset.creator,
      asset_type: asset.assetType,
      license_type: asset.license?.name || asset.license?.code || asset.license?.url || null,
      price: asset.priceUsd,
      preview_url: asset.previewUrl || null,
      attribution_required: asset.license?.attributionRequired ?? null,
      policy_verdict: asset.policy?.verdict || null,
      policy_summary: asset.policy?.summary || null,
    })),
  });

  const guard = canCallOpenRouter("rank_results", payload);
  if (!guard.ok) {
    logOpenRouterEvent({ functionName: "rank_results", model: RANK_RESULTS_MODEL, success: false, fallback: true, reason: guard.reason });
    return { results: candidates, ranking: { used: false, mode: "fallback-unranked", error: guard.reason, guardrails: openRouterGuardrailStatus() } };
  }

  try {
    const body = await requestStructuredJson({
      functionName: "rank_results",
      model: RANK_RESULTS_MODEL,
      schemaName: "zito_rank_results",
      schema: RANK_RESULTS_SCHEMA,
      maxTokens: 350,
      messages: [
        {
          role: "system",
          content:
            "Rank only the supplied candidate assets for fit to the brief. Do not invent assets. Do not decide legal clearance. Return one short reason per candidate.",
        },
        { role: "user", content: payload.slice(0, config.openRouter.maxInputChars) },
      ],
    });
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}");
    const ranked = validateRanking(parsed, candidates);
    return { results: applyRanking(candidates, ranked), ranking: { used: true, mode: "ai-assisted" } };
  } catch (error) {
    logOpenRouterEvent({ functionName: "rank_results", model: RANK_RESULTS_MODEL, success: false, fallback: true, reason: error.message });
    return { results: candidates, ranking: { used: false, mode: "fallback-unranked", error: error.message, guardrails: openRouterGuardrailStatus() } };
  }
}

export function selectModel(input = {}) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return request.rankResults ? RANK_RESULTS_MODEL : PARSE_BRIEF_MODEL;
}

async function requestStructuredJson({ functionName, model, schemaName, schema, maxTokens, messages }) {
  const startedAt = Date.now();
  const body = await fetchJson(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.openRouter.siteUrl,
      "X-OpenRouter-Title": config.openRouter.appName,
      "X-Title": config.openRouter.appName,
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
      temperature: 0,
      max_tokens: maxTokens,
    }),
    timeoutMs: 15_000,
  });
  recordOpenRouterUsage(functionName, model, body, startedAt);
  return body;
}

function buildBriefResult(body, local, input) {
  const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}");
  const validated = validateParsedBrief(parsed);
  const usageRights = validated.usage_rights;
  const translatedQuery = oneLine(validated.translated_query);
  const providerQuery = translatedQuery || local.query;
  const brief = {
    ...local,
    originalQuery: local.originalQuery || local.query,
    query: providerQuery,
    sourceLanguage: validated.source_language || local.sourceLanguage || "Unknown",
    translated: Boolean(translatedQuery && translatedQuery.toLowerCase() !== String(local.query || "").toLowerCase()),
    mood: validated.mood,
    formatConstraints: validated.format_constraints,
    assetType: input.assetType || resolveAssetType(local.assetType, validated.asset_type),
    intendedUse: input.intendedUse || usageRightsToIntendedUse(usageRights),
    commercial: input.commercial === true || ["commercial", "broadcast", "resale"].includes(usageRights),
    broadcast: input.broadcast === true || usageRights === "broadcast",
    budgetUsd: input.budgetUsd ?? validated.max_price ?? local.budgetUsd,
    keywords: mergeKeywords(validated.keywords, local.keywords),
  };
  return {
    brief,
    brain: {
      used: true,
      mode: "ai-assisted",
      multilingual: {
        sourceLanguage: brief.sourceLanguage,
        originalQuery: brief.originalQuery,
        providerQuery: brief.query,
        translated: brief.translated,
      },
    },
  };
}

function validateParsedBrief(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("parse_brief returned invalid JSON");
  if (!ASSET_TYPE_MAP[parsed.asset_type]) throw new Error("parse_brief returned invalid asset_type");
  if (!USAGE_RIGHTS.has(parsed.usage_rights)) throw new Error("parse_brief returned invalid usage_rights");
  return {
    asset_type: parsed.asset_type,
    usage_rights: parsed.usage_rights,
    source_language: oneLine(parsed.source_language || "Unknown"),
    translated_query: oneLine(parsed.translated_query || ""),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean).slice(0, 12) : [],
    mood: parsed.mood == null ? null : String(parsed.mood),
    max_price: parsed.max_price == null ? null : Number(parsed.max_price),
    format_constraints: parsed.format_constraints == null ? null : String(parsed.format_constraints),
  };
}

function validateRanking(parsed, candidates) {
  if (!parsed || !Array.isArray(parsed.ranked)) throw new Error("rank_results returned invalid JSON");
  const allowed = new Set(candidates.map((asset) => `${asset.provider}:${asset.id}`));
  const seen = new Set();
  const ranked = [];
  for (const item of parsed.ranked) {
    const key = `${item.source}:${item.asset_id}`;
    if (!allowed.has(key)) throw new Error("rank_results returned an unknown asset_id/source pair");
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ key, reason: oneLine(item.reason) });
  }
  return ranked;
}

function applyRanking(candidates, ranked) {
  const byKey = new Map(candidates.map((asset) => [`${asset.provider}:${asset.id}`, asset]));
  const rankedKeys = new Set(ranked.map((item) => item.key));
  const ordered = ranked.map((item) => ({ ...byKey.get(item.key), aiRankReason: item.reason }));
  const unmentioned = candidates.filter((asset) => !rankedKeys.has(`${asset.provider}:${asset.id}`));
  return [...ordered, ...unmentioned];
}

function canCallOpenRouter(functionName, input) {
  if (Number.isFinite(config.openRouter.maxSpendUsd) && config.openRouter.maxSpendUsd <= openRouterUsage.estimatedSpendUsd) {
    return { ok: false, reason: `OpenRouter budget guard blocked ${functionName}: estimated spend reached $${config.openRouter.maxSpendUsd}` };
  }
  if (recentCallCount() >= config.openRouter.maxCallsPerMinute) {
    return { ok: false, reason: `OpenRouter rate guard blocked ${functionName}: calls per minute limit reached` };
  }
  if (String(input || "").length > config.openRouter.maxInputChars) {
    return { ok: false, reason: `OpenRouter input guard blocked ${functionName}: input exceeded ${config.openRouter.maxInputChars} characters` };
  }
  return { ok: true };
}

function recordOpenRouterUsage(functionName, model, body, startedAt) {
  const cost = Number(body?.usage?.cost || 0);
  if (Number.isFinite(cost) && cost > 0) openRouterUsage.estimatedSpendUsd += cost;
  const event = {
    at: new Date().toISOString(),
    functionName,
    model: body?.model || model,
    inputSize: Number(body?.usage?.prompt_tokens || 0),
    outputSize: Number(body?.usage?.completion_tokens || 0),
    tokenCostUsd: Number((Number.isFinite(cost) ? cost : 0).toFixed(8)),
    success: true,
    durationMs: Date.now() - startedAt,
  };
  openRouterUsage.calls.push(Date.now());
  logOpenRouterEvent(event);
}

function logOpenRouterEvent(event) {
  openRouterUsage.events.push(event);
  if (openRouterUsage.events.length > 50) openRouterUsage.events.splice(0, openRouterUsage.events.length - 50);
  console.log(`[openrouter] ${JSON.stringify(event)}`);
}

function recentCallCount() {
  const cutoff = Date.now() - 60_000;
  while (openRouterUsage.calls.length && openRouterUsage.calls[0] < cutoff) openRouterUsage.calls.shift();
  return openRouterUsage.calls.length;
}

function usageRightsToIntendedUse(usageRights) {
  if (usageRights === "broadcast") return "broadcast_content";
  if (usageRights === "resale") return "resale_content";
  if (usageRights === "commercial") return "commercial_content";
  return "personal_content";
}

function mergeKeywords(modelKeywords, localKeywords) {
  return Array.from(new Set([...(modelKeywords || []), ...(localKeywords || [])].map((word) => String(word).toLowerCase().trim()).filter(Boolean))).slice(0, 12);
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function resolveAssetType(localAssetType, parsedAssetType) {
  const parsed = ASSET_TYPE_MAP[parsedAssetType] || localAssetType;
  if (localAssetType === "image" && parsed === "music") return "image";
  if (localAssetType === "sound_effect" && parsed === "music") return "sound_effect";
  if (SUPPORTED_ASSET_TYPES.has(parsed)) return parsed;
  if (SUPPORTED_ASSET_TYPES.has(localAssetType)) return localAssetType;
  return "music";
}
