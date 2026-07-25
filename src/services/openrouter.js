import { config } from "../config.js";
import { normalizeBriefLocally } from "../core/brief.js";
import { fetchJson } from "../lib/http.js";
import { readPersistedSpendUsd, recordSpendUsd } from "./usage-store.js";

const DEFAULT_PARSE_BRIEF_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_RANK_RESULTS_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const ASSET_TYPE_MAP = { image: "image", music: "music", sfx: "sound_effect" };
const SUPPORTED_ASSET_TYPES = new Set(["image", "music", "sound_effect"]);
const USAGE_RIGHTS = new Set(["personal", "commercial", "broadcast", "resale"]);

const openRouterUsage = {
  estimatedSpendUsd: 0,
  calls: [],
  events: [],
  spendRestored: false,
};

// Loads the persisted spend total once, so a redeploy resumes the running total instead
// of handing out a fresh budget. Called at startup; safe to call more than once.
export async function restoreSpendFromStore() {
  if (openRouterUsage.spendRestored) return openRouterUsage.estimatedSpendUsd;
  const persisted = await readPersistedSpendUsd();
  if (persisted != null && persisted > openRouterUsage.estimatedSpendUsd) {
    openRouterUsage.estimatedSpendUsd = persisted;
  }
  openRouterUsage.spendRestored = true;
  return openRouterUsage.estimatedSpendUsd;
}

// Test seam: lets a test reset accumulated spend between cases.
export function __resetSpendForTests() {
  openRouterUsage.estimatedSpendUsd = 0;
  openRouterUsage.spendRestored = false;
  openRouterUsage.calls.length = 0;
}

// Every property carries an explicit `type`. Enum-only properties are not valid under
// strict structured outputs: providers that enforce `strict: true` satisfy `required`
// by emitting `null`, which silently discarded an otherwise-complete brief.
const PARSE_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    asset_type: { type: "string", enum: ["image", "music", "sfx"] },
    usage_rights: { type: "string", enum: ["personal", "commercial", "broadcast", "resale"] },
    source_language: { type: "string" },
    translated_query: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    // The concepts a result must actually convey to count as a match. Checked against
    // what the provider returns, so an off-target catalogue result is labelled rather
    // than presented as a match.
    core_concepts: { type: "array", items: { type: "string" } },
    // Different ways to ask the same thing. A catalogue that has nothing for one
    // phrasing often has good results for another.
    alternate_queries: { type: "array", items: { type: "string" } },
    mood: { type: ["string", "null"] },
    max_price: { type: ["number", "null"] },
    format_constraints: { type: ["string", "null"] },
  },
  required: ["asset_type", "usage_rights", "source_language", "translated_query", "keywords", "core_concepts", "alternate_queries", "mood", "max_price", "format_constraints"],
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

function parseBriefModel() {
  return config.openRouter.fastModel || DEFAULT_PARSE_BRIEF_MODEL;
}

function rankResultsModel() {
  return config.openRouter.smartModel || DEFAULT_RANK_RESULTS_MODEL;
}

// Ordered list of models to try for one function. The fallback is from a different
// provider, so a provider-wide incident costs quality on one call rather than dropping
// the whole AI layer. Duplicates are removed so a shared override does not retry the
// same failing model twice.
function parseBriefChain() {
  return dedupe([parseBriefModel(), config.openRouter.fastFallbackModel]);
}

function rankResultsChain() {
  return dedupe([rankResultsModel(), config.openRouter.smartFallbackModel]);
}

function dedupe(models) {
  return [...new Set(models.filter(Boolean))];
}

export function brainStatus() {
  return {
    configured: Boolean(config.openRouter.apiKey),
    status: config.openRouter.apiKey ? "ready" : "fallback",
    fallbackAvailable: true,
    models: {
      parseBrief: parseBriefModel(),
      parseBriefFallback: parseBriefChain()[1] || null,
      rankResults: rankResultsModel(),
      rankResultsFallback: rankResultsChain()[1] || null,
    },
    guardrails: {
      maxCallsPerMinute: config.openRouter.maxCallsPerMinute,
      maxInputChars: config.openRouter.maxInputChars,
      maxSpendUsd: config.openRouter.maxSpendUsd,
    },
  };
}

export function internalBrainStatus() {
  return {
    configured: Boolean(config.openRouter.apiKey),
    model: parseBriefModel(),
    fastModel: parseBriefModel(),
    smartModel: rankResultsModel(),
    parseBriefModel: parseBriefModel(),
    rankResultsModel: rankResultsModel(),
    parseBriefChain: parseBriefChain(),
    rankResultsChain: rankResultsChain(),
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
    logOpenRouterEvent({ functionName: "parse_brief", model: parseBriefModel(), success: false, fallback: true, reason: guard.reason });
    return { brief: local, brain: { used: false, mode: "local-fallback", error: guard.reason, guardrails: openRouterGuardrailStatus() } };
  }

  try {
    const attempt = await requestWithFallback({
      functionName: "parse_brief",
      models: parseBriefChain(),
      schemaName: "zito_parse_brief",
      schema: PARSE_BRIEF_SCHEMA,
      maxTokens: 180,
      // Parsing the model's own output is part of the attempt: a model that returns
      // unusable JSON should hand over to the fallback, not degrade to the local parser.
      validate: (body) => JSON.parse(body.choices?.[0]?.message?.content || "{}"),
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
              "Set usage_rights to personal unless the request clearly signals business use: advertising, marketing, a client or brand campaign, a monetised channel, broadcast, or resale.",
              "A private, family, or hobby request is personal even when it names an occasion such as a birthday or wedding.",
              "languageHint is a deterministic guess from the caller's own detector. Prefer it when the request is short or the language is easy to confuse, and override it only when the text clearly says otherwise.",
              "Translate the meaning, not the individual words. In Hausa, bikin haihuwa is a birthday celebration and bikin aure is a wedding; in Yoruba, ayeye ojo ibi is a birthday.",
              "Set core_concepts to the two to four English ideas a result must actually be about for it to count as a match. Use the subject matter, occasion, mood or setting. Never include the media type itself, so not music, song, image, photo or sound.",
              "Set alternate_queries to two or three differently worded English searches for the same intent, for when a catalogue has nothing under the first phrasing. Vary the vocabulary rather than reordering the same words: for a birthday request try celebration, party, and happy birthday.",
              "Do not decide licensing eligibility. Return only JSON that matches the schema.",
            ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            query: request.query || "",
            languageHint: local.sourceLanguage === "Unknown" ? null : local.sourceLanguage,
            assetTypeHint: request.assetType || null,
            intendedUse: request.intendedUse || null,
            commercial: request.commercial ?? null,
            territory: request.territory || null,
          }).slice(0, config.openRouter.maxInputChars),
        },
      ],
    });
    return buildBriefResult(attempt, local, request);
  } catch (error) {
    return {
      brief: local,
      brain: {
        used: false,
        mode: "local-fallback",
        attemptedModels: parseBriefChain(),
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
    logOpenRouterEvent({ functionName: "rank_results", model: rankResultsModel(), success: false, fallback: true, reason: guard.reason });
    return { results: candidates, ranking: { used: false, mode: "fallback-unranked", error: guard.reason, guardrails: openRouterGuardrailStatus() } };
  }

  try {
    const attempt = await requestWithFallback({
      functionName: "rank_results",
      models: rankResultsChain(),
      schemaName: "zito_rank_results",
      schema: RANK_RESULTS_SCHEMA,
      maxTokens: 350,
      // A model that invents an asset id fails validation and hands over to the
      // fallback, rather than costing the caller its ranking entirely.
      validate: (body) => validateRanking(JSON.parse(body.choices?.[0]?.message?.content || "{}"), candidates),
      messages: [
        {
          role: "system",
          content:
            "Rank only the supplied candidate assets for fit to the brief. Do not invent assets. Do not decide legal clearance. Return one short reason per candidate.",
        },
        { role: "user", content: payload.slice(0, config.openRouter.maxInputChars) },
      ],
    });
    return {
      results: applyRanking(candidates, attempt.value),
      ranking: {
        used: true,
        mode: attempt.usedFallback ? "ai-assisted-fallback-model" : "ai-assisted",
        model: attempt.model,
        usedFallbackModel: attempt.usedFallback,
      },
    };
  } catch (error) {
    return { results: candidates, ranking: { used: false, mode: "fallback-unranked", attemptedModels: rankResultsChain(), error: error.message, guardrails: openRouterGuardrailStatus() } };
  }
}

export function selectModel(input = {}) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return request.rankResults ? rankResultsModel() : parseBriefModel();
}

// Runs `validate` against each model in the chain until one produces usable output.
// A model that errors, or that returns output the caller cannot use, is treated the
// same way: move to the next model. Only when every model in the chain has failed does
// the caller fall back to the deterministic local path.
async function requestWithFallback({ functionName, models, schemaName, schema, maxTokens, messages, validate }) {
  let lastError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const body = await requestStructuredJson({ functionName, model, schemaName, schema, maxTokens, messages });
      const value = validate(body);
      if (index > 0) {
        logOpenRouterEvent({ functionName, model, success: true, recoveredByFallback: true, afterFailing: models[index - 1] });
      }
      return { value, model, usedFallback: index > 0 };
    } catch (error) {
      lastError = error;
      const isLast = index === models.length - 1;
      logOpenRouterEvent({
        functionName,
        model,
        success: false,
        fallback: !isLast,
        willRetryWith: isLast ? null : models[index + 1],
        reason: error.message,
      });
    }
  }

  throw lastError || new Error(`${functionName} failed on every model`);
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

function buildBriefResult(attempt, local, input) {
  const validated = validateParsedBrief(attempt.value);
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
    // Falls back to concepts derived locally from the request, so relevance checking
    // still works when the model returns nothing usable here.
    coreConcepts: validated.core_concepts.length ? validated.core_concepts : local.coreConcepts,
    alternateQueries: validated.alternate_queries,
  };
  return {
    brief,
    brain: {
      used: true,
      mode: attempt.usedFallback ? "ai-assisted-fallback-model" : "ai-assisted",
      model: attempt.model,
      usedFallbackModel: attempt.usedFallback,
      multilingual: {
        sourceLanguage: brief.sourceLanguage,
        originalQuery: brief.originalQuery,
        providerQuery: brief.query,
        translated: brief.translated,
      },
    },
  };
}

// The translation is the valuable part of a brief. A single unrecognised classifier
// value must never discard it: asset_type falls back to local inference and
// usage_rights to the conservative "personal" default. Only structurally unusable
// output (non-object, or no usable query at all) is rejected outright.
function validateParsedBrief(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("parse_brief returned invalid JSON");
  const assetType = ASSET_TYPE_MAP[parsed.asset_type] ? parsed.asset_type : null;
  const usageRights = USAGE_RIGHTS.has(parsed.usage_rights) ? parsed.usage_rights : "personal";
  return {
    asset_type: assetType,
    usage_rights: usageRights,
    source_language: oneLine(parsed.source_language || "Unknown"),
    translated_query: oneLine(parsed.translated_query || ""),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean).slice(0, 12) : [],
    core_concepts: cleanStringList(parsed.core_concepts, 4),
    alternate_queries: cleanStringList(parsed.alternate_queries, 3),
    mood: parsed.mood == null ? null : String(parsed.mood),
    max_price: parsed.max_price == null ? null : Number(parsed.max_price),
    format_constraints: parsed.format_constraints == null ? null : String(parsed.format_constraints),
  };
}

// Lowercased, de-duplicated, length-capped. The model occasionally returns the media
// type as a concept despite being told not to; those are dropped here because every
// result in a lane satisfies them, so matching on them proves nothing.
const NON_CONCEPT_WORDS = new Set([
  "music", "song", "songs", "track", "tracks", "audio", "sound", "sounds", "sfx",
  "image", "images", "photo", "photos", "picture", "pictures", "video", "media",
]);

function cleanStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  const cleaned = [];
  for (const item of value) {
    const text = oneLine(item).toLowerCase();
    if (!text || NON_CONCEPT_WORDS.has(text) || cleaned.includes(text)) continue;
    cleaned.push(text);
  }
  return cleaned.slice(0, limit);
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
  if (Number.isFinite(cost) && cost > 0) {
    openRouterUsage.estimatedSpendUsd += cost;
    // Persisted after the response is already in hand, and never awaited: the ceiling is
    // a guardrail, so a storage failure must cost accuracy rather than the request.
    recordSpendUsd(cost).then((total) => {
      if (total != null && total > openRouterUsage.estimatedSpendUsd) {
        // Another replica has spent more than this process knows about.
        openRouterUsage.estimatedSpendUsd = total;
      }
    }).catch(() => {});
  }
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
