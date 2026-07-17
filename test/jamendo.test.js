import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { jamendoProvider } from "../src/providers/gated.js";
import { jamendoStatus } from "../src/services/jamendo.js";

test("Jamendo search uses read-only catalog API with commercial licensing filters", async () => {
  const previousFetch = globalThis.fetch;
  const previousClientId = config.credentials.jamendo.clientId;
  let requestedUrl = null;

  config.credentials.jamendo.clientId = "jamendo-client";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      headers: { status: "success" },
      results: [
        {
          id: "123",
          name: "Bright Campaign Track",
          artist_id: "99",
          artist_name: "Jam Artist",
          album_id: "77",
          album_name: "Campaign Album",
          audio: "https://audio.example/stream.mp3",
          audiodownload: "https://audio.example/download.mp3",
          audiodownload_allowed: false,
          shareurl: "https://www.jamendo.com/track/123",
          prourl: "https://licensing.jamendo.com/track/123",
          license_ccurl: "https://creativecommons.org/licenses/by/4.0/",
          musicinfo: { tags: { genres: ["pop"], vartags: ["uplifting"] } },
          licenses: [{ name: "CC BY" }],
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const results = await jamendoProvider.search({
      query: "upbeat advert music",
      assetType: "music",
      commercial: true,
      keywords: ["upbeat", "advert"],
    }, 1);

    assert.equal(requestedUrl.startsWith("https://api.jamendo.com/v3.0/tracks/?"), true);
    assert.match(requestedUrl, /client_id=jamendo-client/);
    assert.match(requestedUrl, /include=musicinfo\+licenses/);
    assert.match(requestedUrl, /prolicensing=1/);
    assert.match(requestedUrl, /groupby=artist_id/);
    assert.equal(results[0].previewUrl, "https://audio.example/stream.mp3");
    assert.equal(results[0].mediaUrl, null);
    assert.equal(results[0].purchaseUrl, "https://licensing.jamendo.com/track/123");
    assert.deepEqual(results[0].metadata.tags, ["pop", "uplifting"]);
    assert.equal(results[0].metadata.proLicenseUrl, "https://licensing.jamendo.com/track/123");
    assert.equal(results[0].metadata.jamendoReadOnlyApi, true);
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.jamendo.clientId = previousClientId;
  }
});

test("Jamendo status is explicit about read-only catalog mode", () => {
  const status = jamendoStatus();
  assert.equal(status.provider, "jamendo");
  assert.equal(status.mode, "read_only_catalog");
  assert.ok(status.capabilities.includes("license_terms_capture"));
  assert.ok(status.limits.some((item) => item.includes("does not perform a paid license purchase")));
});
