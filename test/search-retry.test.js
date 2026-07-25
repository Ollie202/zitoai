// Retrying with different wording is what turns a catalogue miss into a match. A Hausa
// birthday request used to return "I'm Walking Away" under one phrasing; a second
// phrasing of the same intent returns actual birthday tracks.
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { jamendoProvider } from "../src/providers/gated.js";
import { searchAssets } from "../src/services/search-service.js";

function stubJamendo(byQuery) {
  const queries = [];
  const original = jamendoProvider.search;
  jamendoProvider.search = async (brief) => {
    queries.push(brief.query);
    return byQuery[brief.query] || byQuery.__default || [];
  };
  return { queries, restore: () => { jamendoProvider.search = original; } };
}

function track(id, title, tags = []) {
  return {
    id, provider: "jamendo", title, creator: "Artist", assetType: "music",
    previewUrl: null, mediaUrl: null, sourceUrl: `https://www.jamendo.com/track/${id}`,
    priceUsd: 0, license: { code: "cc", name: "cc", url: "https://example.com", attributionRequired: true },
    metadata: { tags },
  };
}

function withBrief(brief, run) {
  return async () => {
    const previousKey = config.openRouter.apiKey;
    const previousJamendo = config.credentials.jamendo.clientId;
    const previousFetch = globalThis.fetch;
    config.openRouter.apiKey = "test-key";
    config.credentials.jamendo.clientId = "test-client";

    globalThis.fetch = async () => new Response(JSON.stringify({
      model: "test-model",
      choices: [{ message: { content: JSON.stringify(brief) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    try {
      await run();
    } finally {
      globalThis.fetch = previousFetch;
      config.openRouter.apiKey = previousKey;
      config.credentials.jamendo.clientId = previousJamendo;
    }
  };
}

const BIRTHDAY_BRIEF = {
  asset_type: "music",
  usage_rights: "personal",
  source_language: "Hausa",
  translated_query: "birthday celebration song",
  keywords: ["birthday"],
  core_concepts: ["birthday", "celebration"],
  alternate_queries: ["happy birthday music", "party music"],
  mood: "celebratory",
  max_price: null,
  format_constraints: null,
};

test("a catalogue miss is retried with different wording", withBrief(BIRTHDAY_BRIEF, async () => {
  const stub = stubJamendo({
    // The first phrasing returns the exact off-target result seen in production.
    "birthday celebration song": [track("1", "I'm Walking Away", ["rock", "indie"])],
    "happy birthday music": [track("2", "Happy Birthday", ["birthday", "celebration"])],
  });

  try {
    const result = await searchAssets({ query: "ina bukatar wakar bikin haihuwa", limit: 3 });
    assert.deepEqual(stub.queries.slice(0, 2), ["birthday celebration song", "happy birthday music"]);
    assert.equal(result.processing.usedAlternateQuery, true);
    assert.equal(result.matchQuality.quality, "strong");
    assert.equal(result.results[0].title, "Happy Birthday");
  } finally {
    stub.restore();
  }
}));

test("a good first result is not retried, so no wasted provider calls", withBrief(BIRTHDAY_BRIEF, async () => {
  const stub = stubJamendo({
    "birthday celebration song": [track("1", "Happy Birthday Celebration", ["birthday", "celebration"])],
  });

  try {
    const result = await searchAssets({ query: "birthday music", limit: 3 });
    assert.deepEqual(stub.queries, ["birthday celebration song"], "one search is enough");
    assert.equal(result.processing.usedAlternateQuery, false);
    assert.equal(result.matchQuality.quality, "strong");
  } finally {
    stub.restore();
  }
}));

test("a worse rephrasing never replaces a better first attempt", withBrief(BIRTHDAY_BRIEF, async () => {
  const stub = stubJamendo({
    "birthday celebration song": [track("1", "Celebration Time", ["celebration"])],
    "happy birthday music": [track("2", "Unrelated Noise", ["noise"])],
    "party music": [track("3", "More Noise", ["noise"])],
    __default: [],
  });

  try {
    const result = await searchAssets({ query: "birthday music", limit: 3 });
    assert.equal(result.results[0].title, "Celebration Time", "the better attempt is kept");
    assert.equal(result.matchQuality.quality, "partial");
  } finally {
    stub.restore();
  }
}));

test("retries are capped so an unmatchable request cannot fan out", withBrief(
  { ...BIRTHDAY_BRIEF, alternate_queries: ["alt one", "alt two", "alt three", "alt four"] },
  async () => {
    const stub = stubJamendo({ __default: [track("9", "Nothing Related", ["unrelated"])] });

    try {
      await searchAssets({ query: "something with no match at all", limit: 3 });
      assert.ok(stub.queries.length <= 3, `expected at most 3 provider rounds, got ${stub.queries.length}`);
    } finally {
      stub.restore();
    }
  },
));

test("when nothing matches, the caller is told rather than handed the wrong asset", withBrief(BIRTHDAY_BRIEF, async () => {
  const stub = stubJamendo({ __default: [track("9", "Completely Unrelated", ["unrelated"])] });

  try {
    const result = await searchAssets({ query: "ina bukatar wakar bikin haihuwa", limit: 3 });
    assert.equal(result.matchQuality.quality, "weak");
    assert.match(result.matchQuality.notice, /no results that match/);
    assert.match(result.matchQuality.notice, /may be unrelated/);
    // The results are still returned — labelled, not hidden.
    assert.equal(result.count, 1);
    assert.equal(result.results[0].relevance.strength, "weak");
  } finally {
    stub.restore();
  }
}));

test("every result carries its own relevance verdict", withBrief(BIRTHDAY_BRIEF, async () => {
  const stub = stubJamendo({
    "birthday celebration song": [
      track("1", "Happy Birthday", ["birthday", "celebration"]),
      track("2", "Celebration", ["celebration"]),
      track("3", "Rock Song", ["rock"]),
    ],
  });

  try {
    const result = await searchAssets({ query: "birthday music", limit: 6 });
    for (const asset of result.results) {
      assert.ok(asset.relevance, `${asset.title} must carry a relevance verdict`);
      assert.ok(["strong", "partial", "weak", "unscored"].includes(asset.relevance.strength));
    }
    // Ordered best-match first.
    assert.equal(result.results[0].title, "Happy Birthday");
    assert.equal(result.results.at(-1).title, "Rock Song");
  } finally {
    stub.restore();
  }
}));
