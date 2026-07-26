// The failure this layer exists to stop: a birthday request came back as "I'm Walking
// Away" and was presented as a match. Translation was never the problem — the provider
// search is literal, so when a catalogue has nothing close it still returns its best
// guess, and nothing marked that guess as off-target.
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractConcepts,
  matchQualityNotice,
  relevanceRank,
  scoreAssetRelevance,
  summariseMatchQuality,
} from "../src/core/relevance.js";

test("concepts describe the subject, not the phrasing around it", () => {
  const concepts = extractConcepts("I need a happy song for my son's birthday party");
  assert.ok(concepts.includes("birthday"), "the occasion is the point of the request");
  assert.ok(concepts.includes("happy"), "the mood is part of the intent");

  // Filler and media-type words would match every result in a lane, proving nothing.
  for (const noise of ["need", "song", "music", "the", "for", "my"]) {
    assert.ok(!concepts.includes(noise), `"${noise}" carries no search intent`);
  }
});

test("concepts survive other scripts and mixed input", () => {
  assert.deepEqual(extractConcepts(""), []);
  assert.deepEqual(extractConcepts(null, undefined), []);
  // Non-Latin text yields tokens rather than throwing; the model normally supplies
  // English concepts, this is the floor when it does not.
  assert.ok(Array.isArray(extractConcepts("生日快乐的音乐")));
});

test("an asset is scored on what the provider says it is about", () => {
  const concepts = ["birthday", "celebration"];

  const onTarget = { title: "Happy Birthday", metadata: { tags: ["birthday", "celebration", "party"] } };
  assert.equal(scoreAssetRelevance(onTarget, concepts).strength, "strong");

  const related = { title: "Celebration Groove", metadata: { tags: ["celebration"] } };
  assert.equal(scoreAssetRelevance(related, concepts).strength, "partial");

  // The exact real-world miss this guards against.
  const offTarget = { title: "I'm Walking Away", metadata: { tags: ["rock", "indie"] } };
  const scored = scoreAssetRelevance(offTarget, concepts);
  assert.equal(scored.strength, "weak");
  assert.equal(scored.score, 0);
  assert.deepEqual(scored.missing, concepts);
});

test("scoring reads every field a provider describes an asset with", () => {
  const concepts = ["thunder"];
  const assets = [
    ["title", { title: "Thunder rolling", metadata: {} }],
    ["tags", { title: "Untitled 4", metadata: { tags: ["storm", "thunder"] } }],
    ["tags", { title: "Untitled 5", metadata: { musicinfo: { tags: { vartags: ["thunder"] } } } }],
    ["tags", { title: "Untitled 6", metadata: { keywords: ["thunder"] } }],
    ["description", { title: "Untitled 7", metadata: { description: "distant thunder over a field" } }],
  ];

  for (const [expectedField, asset] of assets) {
    const scored = scoreAssetRelevance(asset, concepts);
    assert.deepEqual(scored.matched, ["thunder"], `${asset.title}: every field is searched`);
    assert.equal(scored.matchedIn.thunder, expectedField, `${asset.title}: reports where it matched`);
  }
});

// A provider names an asset after its subject. "SpringGardenApril" with rain in its tags
// is not the same answer as "Rain Falling On The Greenhouse", and ranking them equally
// made a correct-but-weak result read as a mistake.
test("where a concept appears decides how much it counts", () => {
  const concepts = ["rain"];
  const inTitle = scoreAssetRelevance({ title: "Rain Falling On The Greenhouse", metadata: {} }, concepts);
  const inTags = scoreAssetRelevance({ title: "SpringGardenApril", metadata: { tags: ["rain", "garden"] } }, concepts);
  const inDescription = scoreAssetRelevance({ title: "Morning Field", metadata: { description: "distant rain" } }, concepts);

  assert.ok(inTitle.score > inTags.score, "a title match beats a tag match");
  assert.ok(inTags.score > inDescription.score, "a tag match beats a description match");

  assert.equal(inTitle.strength, "strong");
  // Only reachable through tags or prose, so it is offered as related, not as the answer.
  assert.equal(inTags.strength, "partial");
  assert.equal(inDescription.strength, "partial");
});

// Threshold tuning alone could not separate these: normalising by concept count means one
// tag match scores 0.6 against a single concept but 0.2 against three, so any cutoff that
// admitted a genuine two-of-three match also admitted a lone tag hit. Strength is decided
// by coverage plus a title gate instead.
test("strength needs most concepts present AND the title to carry one", () => {
  const three = ["rain", "meditation", "calm"];

  // Two of three, with rain in the title — a real match.
  assert.equal(scoreAssetRelevance(
    { title: "Ethereal Rain Atmosphere", metadata: { tags: ["meditation"] } }, three,
  ).strength, "strong");

  // Full coverage, but the concept only ever appears in a tag: still not the answer.
  assert.equal(scoreAssetRelevance(
    { title: "SpringGardenApril", metadata: { tags: ["rain"] } }, ["rain"],
  ).strength, "partial", "a tag-only match cannot be strong at any concept count");

  // Title match, but half the request is missing.
  assert.equal(scoreAssetRelevance(
    { title: "Celebration Groove", metadata: { tags: ["celebration"] } }, ["birthday", "celebration"],
  ).strength, "partial", "a title match alone does not make up for missing concepts");
});

test("a tag-only match ranks below a title match", () => {
  const concepts = ["rain"];
  const tagOnly = { id: "tag", title: "SpringGardenApril", policy: {}, metadata: { tags: ["rain"] } };
  const titled = { id: "title", title: "Rain Falling On The Greenhouse", policy: {}, metadata: {} };

  const ranked = relevanceRank([tagOnly, titled].map((a) => ({ ...a, relevance: scoreAssetRelevance(a, concepts) })));
  assert.equal(ranked[0].id, "title", "the obviously-relevant result comes first");
});

test("matching tolerates plurals and simple word forms", () => {
  const asset = { title: "Birthdays and Celebrations", metadata: {} };
  assert.equal(scoreAssetRelevance(asset, ["birthday", "celebration"]).strength, "strong");
});

test("with nothing to check against, the result is unscored rather than a claimed match", () => {
  const scored = scoreAssetRelevance({ title: "Anything" }, []);
  assert.equal(scored.strength, "unscored");
  assert.equal(scored.score, null);
});

test("the set verdict reflects whether the request was actually answered", () => {
  const weak = { relevance: { strength: "weak", score: 0 } };
  const partial = { relevance: { strength: "partial", score: 0.5 } };
  const strong = { relevance: { strength: "strong", score: 1 } };

  assert.equal(summariseMatchQuality([strong, weak]).quality, "strong");
  assert.equal(summariseMatchQuality([partial, weak]).quality, "partial");
  assert.equal(summariseMatchQuality([weak, weak]).quality, "weak");
  assert.equal(summariseMatchQuality([]).quality, "unscored");
});

test("a failed search says so instead of implying a match", () => {
  const brief = { originalQuery: "mo nilo orin ayeye ojo ibi" };

  const strongNotice = matchQualityNotice({ quality: "strong" }, brief);
  assert.equal(strongNotice, null, "a real match needs no caveat");

  const partialNotice = matchQualityNotice({ quality: "partial" }, brief);
  assert.match(partialNotice, /No exact match/);
  assert.match(partialNotice, /closest available/);

  const weakNotice = matchQualityNotice({ quality: "weak" }, brief);
  assert.match(weakNotice, /no results that match/);
  assert.match(weakNotice, /may be unrelated/);
  // The original wording is echoed so the caller can see what was actually searched for.
  assert.match(weakNotice, /mo nilo orin ayeye ojo ibi/);
});

test("relevance outranks licensing, because a permissive wrong asset is still wrong", () => {
  const wrongButAllowed = { id: "1", policy: { verdict: "allowed" }, priceUsd: 0, relevance: { strength: "weak", score: 0 } };
  const rightButReview = { id: "2", policy: { verdict: "review" }, priceUsd: 5, relevance: { strength: "strong", score: 1 } };

  const [first] = relevanceRank([wrongButAllowed, rightButReview]);
  assert.equal(first.id, "2", "the asset that answers the request comes first");
});

test("ties fall back to licensing verdict, then price", () => {
  const relevance = { strength: "strong", score: 1 };
  const pricey = { id: "pricey", policy: { verdict: "allowed" }, priceUsd: 40, relevance };
  const cheap = { id: "cheap", policy: { verdict: "allowed" }, priceUsd: 2, relevance };
  const restricted = { id: "restricted", policy: { verdict: "review" }, priceUsd: 0, relevance };

  const ranked = relevanceRank([restricted, pricey, cheap]);
  assert.equal(ranked[0].id, "cheap");
  assert.equal(ranked[1].id, "pricey");
  assert.equal(ranked[2].id, "restricted");
});

test("ranking does not mutate the caller's array", () => {
  const input = [
    { id: "a", relevance: { strength: "weak", score: 0 }, policy: {} },
    { id: "b", relevance: { strength: "strong", score: 1 }, policy: {} },
  ];
  const order = input.map((item) => item.id);
  relevanceRank(input);
  assert.deepEqual(input.map((item) => item.id), order);
});
