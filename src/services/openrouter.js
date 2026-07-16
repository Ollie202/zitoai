import { config } from "../config.js";
import { normalizeBriefLocally } from "../core/brief.js";
import { fetchJson } from "../lib/http.js";

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string" },
    assetType: { enum: ["music", "sound_effect", "image", "video"] },
    intendedUse: { type: "string" },
    commercial: { type: "boolean" },
    broadcast: { type: "boolean" },
    rawAssetRequired: { type: "boolean" },
    territory: { type: "string" },
    budgetUsd: { type: ["number", "null"] },
    keywords: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
  required: [
    "query",
    "assetType",
    "intendedUse",
    "commercial",
    "broadcast",
    "rawAssetRequired",
    "territory",
    "budgetUsd",
    "keywords",
  ],
  additionalProperties: false,
};

export function brainStatus() {
  return {
    configured: Boolean(config.openRouter.apiKey),
    model: config.openRouter.fastModel,
    fastModel: config.openRouter.fastModel,
    smartModel: config.openRouter.smartModel,
    fallback: "deterministic-local-parser",
  };
}

export async function normalizeBrief(input) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const local = normalizeBriefLocally(request);
  if (!config.openRouter.apiKey) {
    return { brief: local, brain: { used: false, mode: "local" } };
  }

  const selectedModel = selectModel(request);
  const fallbackModel = selectedModel === config.openRouter.smartModel
    ? config.openRouter.fastModel
    : config.openRouter.smartModel;
  const attemptedModels = [selectedModel];

  try {
    const body = await requestBrief(request, selectedModel);
    return buildBrainResult(body, local, request, selectedModel, attemptedModels);
  } catch (firstError) {
    if (fallbackModel === selectedModel) {
      return {
        brief: local,
        brain: { used: false, mode: "local-fallback", error: firstError.message },
      };
    }

    attemptedModels.push(fallbackModel);
    try {
      const body = await requestBrief(request, fallbackModel);
      return buildBrainResult(body, local, request, fallbackModel, attemptedModels, firstError);
    } catch (fallbackError) {
      return {
        brief: local,
        brain: {
          used: false,
          mode: "local-fallback",
          attemptedModels,
          error: `${firstError.message}; fallback: ${fallbackError.message}`,
        },
      };
    }
  }
}

export function selectModel(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const serialized = JSON.stringify(input);
  const text = [
    input.query,
    input.assetType,
    input.intendedUse,
    input.territory,
    ...(Array.isArray(input.keywords) ? input.keywords : []),
  ].filter(Boolean).join(" ").toLowerCase();
  const complexSignals = [
    "license",
    "licence",
    "terms",
    "restriction",
    "commercial",
    "broadcast",
    "client",
    "resale",
    "distribution",
    "royalty",
    "subscription",
    "editorial",
  ];
  const nonGlobalTerritory = input.territory && !/^(worldwide|global)$/i.test(String(input.territory).trim());
  const hasComplexSignal = input.commercial === true || nonGlobalTerritory || complexSignals.some((signal) => text.includes(signal));
  return hasComplexSignal || serialized.length > 1_200
    ? config.openRouter.smartModel
    : config.openRouter.fastModel;
}

async function requestBrief(input, model) {
  return fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.openRouter.siteUrl,
      "X-Title": config.openRouter.appName,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Convert an asset request into a procurement brief. Do not make legal conclusions. Preserve explicit user constraints. Return only the requested JSON.",
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "zito_brief", strict: true, schema: BRIEF_SCHEMA },
      },
      temperature: 0.1,
      max_tokens: 500,
    }),
    timeoutMs: 20_000,
  });
}

function buildBrainResult(body, local, input, model, attemptedModels, firstError = null) {
  const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}");
  return {
    brief: {
      ...local,
      ...parsed,
      query: local.query,
      assetType: input.assetType || parsed.assetType || local.assetType,
      intendedUse: input.intendedUse || parsed.intendedUse || local.intendedUse,
      budgetUsd: local.budgetUsd,
    },
    brain: {
      used: true,
      mode: "openrouter",
      model: body.model || model,
      selectedModel: model,
      attemptedModels,
      routedBy: firstError ? "fallback" : "complexity",
      usage: body.usage || null,
    },
  };
}
