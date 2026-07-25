// A single missing await once caused every multilingual request to degrade silently.
// These cover the recovery path: a failing or unusable primary model must hand over to
// a fallback from another provider before the service drops to the local parser.
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { brainStatus, internalBrainStatus, normalizeBrief, rankResultsWithOpenRouter } from "../src/services/openrouter.js";

const GOOD_BRIEF = {
  asset_type: "music",
  usage_rights: "personal",
  source_language: "Yoruba",
  translated_query: "birthday celebration music",
  keywords: ["birthday"],
  mood: "celebratory",
  max_price: null,
  format_constraints: null,
};

function reply(content, model = "test-model") {
  return new Response(JSON.stringify({
    model,
    usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 },
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function withStubbedFetch(handler, run) {
  return async () => {
    const previousFetch = globalThis.fetch;
    const previousKey = config.openRouter.apiKey;
    const previousLimit = config.openRouter.maxCallsPerMinute;
    config.openRouter.apiKey = "test-openrouter-key";
    config.openRouter.maxCallsPerMinute = 1000;
    const calls = [];
    globalThis.fetch = async (_url, options = {}) => {
      const sent = JSON.parse(options.body);
      calls.push(sent.model);
      return handler(sent.model, sent, calls.length);
    };
    try {
      await run(calls);
    } finally {
      globalThis.fetch = previousFetch;
      config.openRouter.apiKey = previousKey;
      config.openRouter.maxCallsPerMinute = previousLimit;
    }
  };
}

test("the primary and fallback models are from different providers", () => {
  const { models } = brainStatus();
  assert.ok(models.parseBrief, "a parse model must be configured");
  assert.ok(models.parseBriefFallback, "a parse fallback must be configured");
  assert.notEqual(models.parseBrief, models.parseBriefFallback, "the fallback must not be the failing model");

  const providerOf = (id) => String(id).split("/")[0];
  assert.notEqual(
    providerOf(models.parseBrief),
    providerOf(models.parseBriefFallback),
    "a provider-wide incident must not take out both models",
  );
  assert.notEqual(models.rankResults, models.rankResultsFallback);
});

test("a chain never retries the same model twice", () => {
  const previousSmart = config.openRouter.smartModel;
  const previousFallback = config.openRouter.smartFallbackModel;
  config.openRouter.smartModel = "vendor/same-model";
  config.openRouter.smartFallbackModel = "vendor/same-model";
  try {
    assert.deepEqual(internalBrainStatus().rankResultsChain, ["vendor/same-model"]);
  } finally {
    config.openRouter.smartModel = previousSmart;
    config.openRouter.smartFallbackModel = previousFallback;
  }
});

test("parse_brief recovers on the fallback model when the primary errors", withStubbedFetch(
  (model) => {
    if (model === config.openRouter.fastModel) {
      return new Response(JSON.stringify({ error: { message: "upstream model unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return reply(GOOD_BRIEF, model);
  },
  async (calls) => {
    const { brief, brain } = await normalizeBrief({ query: "mo nilo orin ayeye ojo ibi" });
    assert.equal(brain.used, true, "the request must still be AI-assisted");
    assert.equal(brain.usedFallbackModel, true);
    assert.equal(brain.model, config.openRouter.fastFallbackModel);
    assert.equal(brief.query, "birthday celebration music", "the translation must survive the failover");
    assert.equal(brief.translated, true);
    assert.deepEqual(calls, [config.openRouter.fastModel, config.openRouter.fastFallbackModel]);
  },
));

test("parse_brief fails over when the primary returns unparseable output", withStubbedFetch(
  (model) => (model === config.openRouter.fastModel ? reply("this is not json") : reply(GOOD_BRIEF, model)),
  async (calls) => {
    const { brief, brain } = await normalizeBrief({ query: "mo nilo orin ayeye ojo ibi" });
    assert.equal(brain.used, true);
    assert.equal(brain.usedFallbackModel, true);
    assert.equal(brief.query, "birthday celebration music");
    assert.equal(calls.length, 2);
  },
));

test("parse_brief drops to the local parser only after every model fails", withStubbedFetch(
  () => new Response(JSON.stringify({ error: { message: "all models down" } }), { status: 500, headers: { "Content-Type": "application/json" } }),
  async (calls) => {
    const { brief, brain } = await normalizeBrief({ query: "happy birthday song" });
    assert.equal(brain.used, false);
    assert.equal(brain.mode, "local-fallback");
    assert.deepEqual(brain.attemptedModels, [config.openRouter.fastModel, config.openRouter.fastFallbackModel]);
    assert.equal(brief.query, "happy birthday song", "the local parser still returns a usable brief");
    assert.equal(calls.length, 2, "both models must be attempted before giving up");
  },
));

test("the primary model is not retried when it succeeds", withStubbedFetch(
  (model) => reply(GOOD_BRIEF, model),
  async (calls) => {
    const { brain } = await normalizeBrief({ query: "mo nilo orin ayeye ojo ibi" });
    assert.equal(brain.usedFallbackModel, false);
    assert.equal(brain.model, config.openRouter.fastModel);
    assert.deepEqual(calls, [config.openRouter.fastModel], "no wasted second call");
  },
));

const CANDIDATES = [
  { id: "1", provider: "jamendo", title: "Happy Birthday", policy: { verdict: "review" } },
  { id: "2", provider: "jamendo", title: "Good Mood", policy: { verdict: "review" } },
];

test("rank_results fails over when the primary invents an asset", withStubbedFetch(
  (model) => {
    if (model === config.openRouter.smartModel) {
      // A hallucinated id must not simply cost the caller its ranking.
      return reply({ ranked: [{ asset_id: "999", source: "jamendo", reason: "invented" }] }, model);
    }
    return reply({ ranked: [{ asset_id: "2", source: "jamendo", reason: "better fit" }, { asset_id: "1", source: "jamendo", reason: "ok" }] }, model);
  },
  async (calls) => {
    const { results, ranking } = await rankResultsWithOpenRouter({ assetType: "music", query: "birthday" }, CANDIDATES);
    assert.equal(ranking.used, true);
    assert.equal(ranking.usedFallbackModel, true);
    assert.equal(results[0].id, "2", "the fallback model's ordering is applied");
    assert.equal(calls.length, 2);
  },
));

test("rank_results returns unranked candidates when both models fail", withStubbedFetch(
  () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500, headers: { "Content-Type": "application/json" } }),
  async () => {
    const { results, ranking } = await rankResultsWithOpenRouter({ assetType: "music", query: "birthday" }, CANDIDATES);
    assert.equal(ranking.used, false);
    assert.equal(ranking.mode, "fallback-unranked");
    assert.equal(results.length, 2, "the caller still receives every candidate");
  },
));
