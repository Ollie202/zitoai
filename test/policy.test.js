import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAsset } from "../src/core/policy-engine.js";

const commercialBrief = {
  commercial: true,
  broadcast: false,
  rawAssetRequired: true,
  territory: "worldwide",
};

test("Shutterstock stays review-only until checkout evidence exists", () => {
  const result = evaluateAsset({ provider: "shutterstock", license: { code: "shutterstock-platform" } }, commercialBrief);
  assert.equal(result.verdict, "review");
  assert.equal(result.checkoutRequired, true);
});

test("Freesound stays review-only for commercial use", () => {
  const result = evaluateAsset({ provider: "freesound", license: { code: "cc0" } }, commercialBrief);
  assert.equal(result.verdict, "review");
  assert.equal(result.rawDeliveryAllowed, true);
});

test("Jamendo stays review-only for music licensing", () => {
  const result = evaluateAsset(
    { provider: "jamendo", license: { code: "jamendo-license", attributionRequired: true } },
    commercialBrief,
  );
  assert.equal(result.verdict, "review");
  assert.equal(result.checkoutRequired, true);
});
