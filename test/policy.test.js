import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAsset } from "../src/core/policy-engine.js";

const commercialBrief = {
  commercial: true,
  broadcast: false,
  rawAssetRequired: true,
  territory: "worldwide",
};

test("Free To Use is checkout-only for commercial use", () => {
  const result = evaluateAsset({ provider: "free_to_use", license: { code: "free-license" } }, commercialBrief);
  assert.equal(result.verdict, "checkout_only");
  assert.equal(result.rawDeliveryAllowed, false);
});

test("Openverse non-commercial license is rejected for a commercial request", () => {
  const result = evaluateAsset(
    { provider: "openverse", license: { code: "by-nc-nd", attributionRequired: true } },
    commercialBrief,
  );
  assert.equal(result.verdict, "rejected");
});

test("Wikimedia CC BY is allowed with attribution", () => {
  const result = evaluateAsset(
    { provider: "wikimedia", license: { code: "cc-by-4.0", attributionRequired: true } },
    commercialBrief,
  );
  assert.equal(result.verdict, "allowed");
  assert.equal(result.rawDeliveryAllowed, true);
});

test("Stockfilm rights uncertainty remains visible", () => {
  const result = evaluateAsset(
    { provider: "stockfilm", rights: { eligible: true, confidence: "0.6" } },
    commercialBrief,
  );
  assert.equal(result.verdict, "review");
  assert.equal(result.checkoutRequired, true);
});
