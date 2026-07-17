import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { freesoundProvider } from "../src/providers/gated.js";

test("Freesound search uses the v2 search endpoint with token auth and preview fields", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.credentials.freesound.apiKey;
  let requestedUrl = null;

  config.credentials.freesound.apiKey = "fs-token";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      results: [
        {
          id: 42,
          name: "Ambient loop",
          username: "soundmaker",
          license: "Creative Commons 0",
          duration: 12.5,
          tags: ["ambient", "loop"],
          description: "A calm ambient loop",
          url: "https://freesound.org/s/42/",
          previews: {
            "preview-hq-mp3": "https://example.com/hq.mp3",
            "preview-lq-ogg": "https://example.com/lq.ogg",
          },
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const results = await freesoundProvider.search({ query: "ambient loop", assetType: "sound_effect" }, 1);
    assert.equal(requestedUrl.startsWith("https://freesound.org/apiv2/search/?"), true);
    assert.match(requestedUrl, /token=fs-token/);
    assert.match(requestedUrl, /fields=id%2Cname%2Cusername%2Clicense%2Cpreviews%2Cduration%2Ctags%2Cdescription%2Curl/);
    assert.equal(results[0].title, "Ambient loop");
    assert.equal(results[0].previewUrl, "https://example.com/hq.mp3");
    assert.equal(results[0].metadata.oauth2RequiredForOriginalDownload, true);
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.freesound.apiKey = previousKey;
  }
});
