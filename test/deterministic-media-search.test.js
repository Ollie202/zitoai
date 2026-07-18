import test from "node:test";
import assert from "node:assert/strict";
import { deterministicMediaSearch } from "../src/services/deterministic-media-search.js";
import { freesoundProvider, jamendoProvider, shutterstockProvider } from "../src/providers/gated.js";

test("deterministic media search returns Shutterstock image results with preview_url", async () => {
  const previousSearch = shutterstockProvider.search;
  shutterstockProvider.search = async () => [{
    id: "shut-1",
    provider: "shutterstock",
    assetType: "image",
    title: "Hero image",
    creator: "Contributor",
    previewUrl: "https://example.com/shutterstock-preview.jpg",
    sourceUrl: "https://example.com/source",
    purchaseUrl: "https://example.com/purchase",
    license: { code: "shutterstock-platform", name: "Shutterstock Platform License", url: "https://example.com/license", attributionRequired: false },
    metadata: {},
  }];

  try {
    const result = await deterministicMediaSearch({ query: "hero image", assetType: "image", commercial: true });
    assert.equal(result.count, 1);
    assert.equal(result.results[0].source, "shutterstock");
    assert.equal(result.results[0].asset_id, "shut-1");
    assert.equal(result.results[0].preview_url, "https://example.com/shutterstock-preview.jpg");
    assert.equal(result.results[0].attribution_required, false);
  } finally {
    shutterstockProvider.search = previousSearch;
  }
});

test("deterministic media search returns Freesound sfx results with attribution text", async () => {
  const previousSearch = freesoundProvider.search;
  freesoundProvider.search = async () => [{
    id: "fs-1",
    provider: "freesound",
    assetType: "sound_effect",
    title: "Rain loop",
    creator: "Soundmaker",
    previewUrl: "https://example.com/freesound-preview.mp3",
    sourceUrl: "https://example.com/source",
    purchaseUrl: "https://example.com/purchase",
    license: { code: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attributionRequired: true },
    metadata: {},
  }];

  try {
    const result = await deterministicMediaSearch({ query: "rain ambience", assetType: "sound_effect", commercial: false });
    assert.equal(result.count, 1);
    assert.equal(result.results[0].source, "freesound");
    assert.equal(result.results[0].asset_type, "sfx");
    assert.equal(result.results[0].preview_url, "https://example.com/freesound-preview.mp3");
    assert.equal(result.results[0].attribution_required, true);
    assert.match(result.results[0].attribution_text, /Rain loop/);
  } finally {
    freesoundProvider.search = previousSearch;
  }
});

test("deterministic media search drops Jamendo commercial results", async () => {
  const previousSearch = jamendoProvider.search;
  jamendoProvider.search = async () => [{
    id: "jam-1",
    provider: "jamendo",
    assetType: "music",
    title: "Background Tune",
    creator: "Jam Artist",
    previewUrl: "https://example.com/jamendo-preview.mp3",
    sourceUrl: "https://example.com/source",
    purchaseUrl: "https://example.com/purchase",
    license: { code: "https://creativecommons.org/licenses/by-nc/4.0/", name: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/", attributionRequired: true },
    metadata: {},
  }];

  try {
    const result = await deterministicMediaSearch({ query: "music bed", asset_type: "music", usage_rights: "commercial" });
    assert.equal(result.count, 0);
    assert.equal(result.brief.source, "jamendo");
    assert.equal(result.brief.usageRights, "commercial");
  } finally {
    jamendoProvider.search = previousSearch;
  }
});
