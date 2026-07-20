import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { normalizeBriefLocally } from "../src/core/brief.js";
import { normalizeBrief, selectModel } from "../src/services/openrouter.js";

test("simple discovery briefs use the fast model", () => {
  assert.equal(selectModel({ query: "public domain historical photograph", assetType: "image", intendedUse: "personal_content", territory: "worldwide" }), config.openRouter.fastModel);
});

test("ranking requests use the smart model", () => {
  assert.equal(selectModel({ rankResults: true }), config.openRouter.smartModel);
});

test("rain ambience briefs resolve to sound_effect", () => {
  assert.equal(normalizeBriefLocally({ query: "Gentle rain ambience for meditation" }).assetType, "sound_effect");
});

test("local fallback recognizes Nigerian language media cues", () => {
  assert.equal(normalizeBriefLocally({ query: "Mo nilo aworan fun ipolowo app wa" }).assetType, "image");
  assert.equal(normalizeBriefLocally({ query: "Ina bukata wakar Hausa domin talla" }).assetType, "music");
  assert.equal(normalizeBriefLocally({ query: "Abeg find sound wey go fit button click" }).assetType, "sound_effect");
});

test("OpenRouter parser preserves original text and returns provider-ready English query", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouter.apiKey;
  const previousLimit = config.openRouter.maxCallsPerMinute;

  config.openRouter.apiKey = "test-openrouter-key";
  config.openRouter.maxCallsPerMinute = 20;

  globalThis.fetch = async (_url, options = {}) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /Nigerian Pidgin/);
    return new Response(JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      usage: { prompt_tokens: 20, completion_tokens: 40, cost: 0 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              asset_type: "image",
              usage_rights: "commercial",
              source_language: "Yoruba",
              translated_query: "smiling people using a mobile app for an advertisement",
              keywords: ["smiling people", "mobile app", "advertisement"],
              mood: "cheerful",
              max_price: null,
              format_constraints: null,
            }),
          },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { brief, brain } = await normalizeBrief({
      query: "Mo nilo aworan awon eniyan to n rẹrin fun ipolowo app wa",
      territory: "Nigeria",
    });

    assert.equal(brief.originalQuery, "Mo nilo aworan awon eniyan to n rẹrin fun ipolowo app wa");
    assert.equal(brief.query, "smiling people using a mobile app for an advertisement");
    assert.equal(brief.sourceLanguage, "Yoruba");
    assert.equal(brief.assetType, "image");
    assert.equal(brief.commercial, true);
    assert.equal(brain.multilingual.providerQuery, brief.query);
    assert.equal(brain.multilingual.translated, true);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouter.apiKey = previousKey;
    config.openRouter.maxCallsPerMinute = previousLimit;
  }
});
