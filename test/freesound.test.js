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
    assert.equal(requestedUrl.startsWith("https://freesound.org/apiv2/search/text/?"), true);
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

test("Freesound falls back to keyword discovery when exact natural language search is empty", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.credentials.freesound.apiKey;
  const requestedUrls = [];

  config.credentials.freesound.apiKey = "fs-token";
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    const isFallback = !String(url).includes("query=I+need+a+calm+rain+ambience+sound+effect+loop+for+a+meditation+app+background");
    return new Response(JSON.stringify({
      results: isFallback ? [
        {
          id: 84,
          name: "Rain Ambience Loop",
          username: "soundmaker",
          license: "Creative Commons 0",
          duration: 22,
          tags: ["rain", "ambience", "loop"],
          description: "A calm rain ambience loop",
          url: "https://freesound.org/s/84/",
          previews: {
            "preview-hq-mp3": "https://example.com/rain.mp3",
          },
        },
      ] : [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const results = await freesoundProvider.search({
      query: "I need a calm rain ambience sound effect loop for a meditation app background",
      assetType: "sound_effect",
      commercial: true,
      keywords: ["calm", "rain", "ambience", "sound", "effect", "loop", "meditation", "background"],
    }, 1);

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /query=I\+need\+a\+calm\+rain\+ambience\+sound\+effect\+loop\+for\+a\+meditation\+app\+background/);
    assert.doesNotMatch(requestedUrls[1], /need|for|app|background/i);
    assert.equal(results[0].title, "Rain Ambience Loop");
    assert.equal(results[0].metadata.searchFallbackUsed, true);
    assert.equal(results[0].previewUrl, "https://example.com/rain.mp3");
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.freesound.apiKey = previousKey;
  }
});
