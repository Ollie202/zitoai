import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { selectModel } from "../src/services/openrouter.js";

test("simple discovery briefs use the fast model", () => {
  assert.equal(selectModel({ query: "public domain historical photograph", assetType: "image", intendedUse: "personal_content", territory: "worldwide" }), config.openRouter.fastModel);
});

test("commercial rights briefs use the smart model", () => {
  assert.equal(selectModel({ query: "Afrobeats instrumental for paid campaign", assetType: "music", intendedUse: "commercial_content", commercial: true, territory: "Nigeria and UK" }), config.openRouter.smartModel);
});
