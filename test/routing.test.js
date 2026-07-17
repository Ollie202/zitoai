import test from "node:test";
import assert from "node:assert/strict";
import { rankProviders } from "../src/core/provider-routing.js";

const providers = [
  { id: "shutterstock", supportedAssetTypes: ["image"] },
  { id: "freesound", supportedAssetTypes: ["sound_effect"] },
  { id: "jamendo", supportedAssetTypes: ["music"] },
];

test("image requests route Shutterstock first", () => {
  const ranked = rankProviders(providers, {
    query: "commercial product hero image",
    keywords: ["commercial", "product", "image"],
    assetType: "image",
    commercial: true,
    rawAssetRequired: true,
    budgetUsd: 20,
  });
  assert.equal(ranked[0].provider.id, "shutterstock");
});

test("sound effect requests route Freesound first", () => {
  const ranked = rankProviders(providers, {
    query: "ambient sound effect",
    keywords: ["ambient", "sound", "effect"],
    assetType: "sound_effect",
    commercial: true,
    rawAssetRequired: true,
    budgetUsd: null,
  });
  assert.equal(ranked[0].provider.id, "freesound");
});

test("music requests route Jamendo first", () => {
  const ranked = rankProviders(providers, {
    query: "background instrumental music track",
    keywords: ["background", "instrumental", "music"],
    assetType: "music",
    commercial: false,
    rawAssetRequired: true,
    budgetUsd: null,
  });
  assert.equal(ranked[0].provider.id, "jamendo");
});
