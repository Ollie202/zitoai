import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { selectModel } from "../src/services/openrouter.js";

test("simple discovery briefs use the fast model", () => {
  assert.equal(selectModel({ query: "public domain historical photograph", assetType: "image", intendedUse: "personal_content", territory: "worldwide" }), config.openRouter.fastModel);
});

test("ranking requests use the smart model", () => {
  assert.equal(selectModel({ rankResults: true }), config.openRouter.smartModel);
});
