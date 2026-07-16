import test from "node:test";
import assert from "node:assert/strict";
import { rankProviders } from "../src/core/provider-routing.js";

const providers = [
  { id: "stockfilm", supportedAssetTypes: ["video"] },
  { id: "wikimedia", supportedAssetTypes: ["music", "image", "video"] },
  { id: "openverse", supportedAssetTypes: ["music", "image"] },
  { id: "free_to_use", supportedAssetTypes: ["music"] },
];

test("archival video routes Stockfilm first", () => {
  const ranked = rankProviders(providers, {
    query: "vintage archival 8mm footage",
    keywords: ["vintage", "archival", "8mm"],
    assetType: "video",
    commercial: true,
    rawAssetRequired: true,
    budgetUsd: 20,
  });
  assert.equal(ranked[0].provider.id, "stockfilm");
});

test("public-domain image request routes Wikimedia first", () => {
  const ranked = rankProviders(providers, {
    query: "public domain historical image",
    keywords: ["public", "domain", "historical", "image"],
    assetType: "image",
    commercial: true,
    rawAssetRequired: true,
    budgetUsd: null,
  });
  assert.equal(ranked[0].provider.id, "wikimedia");
});

test("configured Jamendo and Freesound receive provider-specific scores", () => {
  const ranked = rankProviders(
    [
      { id: "jamendo", supportedAssetTypes: ["music"] },
      { id: "freesound", supportedAssetTypes: ["music", "sound_effect"] },
    ],
    {
      query: "background instrumental music",
      keywords: ["background", "instrumental", "music"],
      assetType: "music",
      commercial: false,
      rawAssetRequired: true,
      budgetUsd: null,
    },
  );
  assert.ok(ranked.every((entry) => entry.score > -100));
  assert.equal(ranked[0].provider.id, "jamendo");
});
