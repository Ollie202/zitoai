// Regression coverage for defects found in the pre-listing audit. Each test names the
// behaviour that broke in production so a future change cannot quietly reintroduce it.
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { normalizeBriefLocally } from "../src/core/brief.js";
import { normalizeBrief } from "../src/services/openrouter.js";
import { searchAssets } from "../src/services/search-service.js";

// The model returned a complete, correctly translated brief, but `usage_rights` came
// back null because the schema declared an enum with no `type`. Validation threw and
// the entire translation was discarded, so every multilingual request silently fell
// back to the local parser.
test("a null classifier field does not discard the model's translation", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouter.apiKey;
  config.openRouter.apiKey = "test-openrouter-key";

  globalThis.fetch = async () => new Response(JSON.stringify({
    model: "test-model",
    usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 },
    choices: [{
      message: {
        content: JSON.stringify({
          asset_type: "music",
          usage_rights: null, // the exact production failure
          source_language: "Yoruba",
          translated_query: "birthday celebration music",
          keywords: ["birthday", "celebration"],
          mood: "celebratory",
          max_price: null,
          format_constraints: null,
        }),
      },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const { brief, brain } = await normalizeBrief({ query: "mo nilo orin ayeye ojo ibi" });
    assert.equal(brain.used, true, "the model result must be used, not discarded");
    assert.equal(brief.query, "birthday celebration music");
    assert.equal(brief.translated, true);
    assert.equal(brief.sourceLanguage, "Yoruba");
    // An unusable usage_rights falls back to the conservative default.
    assert.equal(brief.commercial, false);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouter.apiKey = previousKey;
  }
});

test("the parse_brief schema types every enum property", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouter.apiKey;
  config.openRouter.apiKey = "test-openrouter-key";
  let schema = null;

  globalThis.fetch = async (_url, options = {}) => {
    schema = JSON.parse(options.body).response_format.json_schema.schema;
    return new Response(JSON.stringify({
      model: "test-model",
      choices: [{ message: { content: "{}" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await normalizeBrief({ query: "birthday music" });
    for (const [name, property] of Object.entries(schema.properties)) {
      assert.ok(property.type, `property "${name}" must declare a type for strict structured output`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouter.apiKey = previousKey;
  }
});

// "ad" was matched as a substring, so sad, shadow, radio, adventure, loading and
// gradient all classified ordinary personal searches as commercial. That narrowed the
// Jamendo query to pro-licensed catalogue only.
test("commercial intent is matched on word boundaries, not substrings", () => {
  const personal = [
    "sad piano music",
    "a sad song for my son",
    "shadow image",
    "adventure background music",
    "loading spinner sound",
    "gradient background image",
  ];
  for (const query of personal) {
    assert.equal(normalizeBriefLocally({ query }).commercial, false, `"${query}" is not a commercial request`);
  }

  const commercial = ["ad campaign music", "music for my brand", "product launch video", "sponsored content music"];
  for (const query of commercial) {
    assert.equal(normalizeBriefLocally({ query }).commercial, true, `"${query}" is a commercial request`);
  }
});

// Broadcast implies commercial in the OpenRouter path. The local path disagreed, so the
// same request was labelled differently depending on whether the model was reachable.
test("broadcast requests are commercial in the local parser too", () => {
  const brief = normalizeBriefLocally({ query: "radio jingle" });
  assert.equal(brief.broadcast, true);
  assert.equal(brief.commercial, true);
  assert.equal(brief.intendedUse, "broadcast_content");
});

// The asset-type detector matched substrings, so "window photo" hit "wind", "brain
// diagram picture" hit "rain" and "stone wall photo" hit "tone" — all routed to
// Freesound instead of Shutterstock.
test("asset type is not decided by substrings inside unrelated words", () => {
  const expectations = [
    ["window photo", "image"],
    ["training montage image", "image"],
    ["brain diagram picture", "image"],
    ["stone wall photo", "image"],
    ["human portrait photo", "image"],
    ["popular music", "music"],
    ["soundtrack for my film", "music"],
    ["a sound of a door closing", "sound_effect"],
    ["white noise", "sound_effect"],
    ["rain ambience", "sound_effect"],
  ];
  for (const [query, expected] of expectations) {
    assert.equal(normalizeBriefLocally({ query }).assetType, expected, `"${query}" should be ${expected}`);
  }
});

test("non-Latin scripts still resolve to the right asset type", () => {
  assert.equal(normalizeBriefLocally({ query: "我需要生日快乐的音乐" }).assetType, "music");
  assert.equal(normalizeBriefLocally({ query: "写真が必要です" }).assetType, "image");
  assert.equal(normalizeBriefLocally({ query: "音效" }).assetType, "sound_effect");
});

// An empty query reached the model, which invented a brief from nothing and returned
// unrelated results — at the cost of two billed model calls per request.
test("an empty query is rejected before any model call", async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("no upstream call should be made for an empty query");
  };

  try {
    for (const input of [{ query: "" }, { query: "   " }, {}, null]) {
      await assert.rejects(() => searchAssets(input), /A search query is required/);
    }
    assert.equal(called, false, "an empty query must not reach the model");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
