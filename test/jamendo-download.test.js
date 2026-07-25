// Jamendo's download endpoint returns a valid MP3 with `Content-Type: text/html`, so
// any client that trusts the header renders binary audio as a web page. ZitoAI re-serves
// those bytes with the correct type through a validated route.
import test from "node:test";
import assert from "node:assert/strict";
import { jamendoProxyDownloadUrl, jamendoTrackId, jamendoUpstreamDownloadUrl } from "../src/services/jamendo-download.js";
import { jamendoProvider } from "../src/providers/gated.js";
import { config } from "../src/config.js";

test("only a numeric track id is accepted", () => {
  assert.equal(jamendoTrackId("1325220"), "1325220");
  assert.equal(jamendoTrackId("7"), "7");

  // The route builds the upstream URL itself, but the id must still never carry a path
  // or a host, or the route becomes a general-purpose proxy.
  for (const hostile of ["abc", "", null, undefined, "../../etc/passwd", "https://evil.com", "1325220/../../x", "1e9", "-1", "12 34", "1325220?x=1"]) {
    assert.equal(jamendoTrackId(hostile), null, `"${hostile}" must be rejected`);
  }
});

test("the upstream URL is built from the id and cannot be redirected elsewhere", () => {
  const url = new URL(jamendoUpstreamDownloadUrl("1325220"));
  assert.equal(url.hostname, "prod-1.storage.jamendo.com");
  assert.equal(url.pathname, "/download/track/1325220/mp32/");
});

test("results link to the ZitoAI route rather than the mislabelled provider URL", () => {
  const proxied = jamendoProxyDownloadUrl("1325220");
  assert.match(proxied, /\/api\/providers\/jamendo\/tracks\/1325220\/download$/);
  assert.ok(proxied.startsWith(config.aspBaseUrl.replace(/\/+$/, "")), "must be served from the ASP base URL");
  assert.doesNotMatch(proxied, /storage\.jamendo\.com/, "must not point at the provider's storage host");
});

test("a downloadable track exposes the proxy URL and an explicit audio content type", async () => {
  const previousFetch = globalThis.fetch;
  const previousClientId = config.credentials.jamendo.clientId;
  config.credentials.jamendo.clientId = "test-client-id";

  globalThis.fetch = async () => new Response(JSON.stringify({
    headers: { status: "success" },
    results: [{
      id: 1325220,
      name: "Happy Birthday",
      artist_name: "Jazzaria",
      audio: "https://prod-1.storage.jamendo.com/?trackid=1325220",
      audiodownload: "https://prod-1.storage.jamendo.com/download/track/1325220/mp32/",
      audiodownload_allowed: true,
      shareurl: "https://www.jamendo.com/track/1325220",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const [asset] = await jamendoProvider.search({ query: "birthday", assetType: "music", keywords: [] }, 1);
    assert.match(asset.mediaUrl, /\/api\/providers\/jamendo\/tracks\/1325220\/download$/);
    assert.equal(asset.mediaContentType, "audio/mpeg");
    assert.equal(asset.previewContentType, "audio/mpeg");
    assert.equal(asset.metadata.rawDownloadUrl, asset.mediaUrl);
    // The provider's own URL stays available, flagged with the defect.
    assert.match(asset.metadata.providerDownloadUrl, /storage\.jamendo\.com/);
    assert.equal(asset.metadata.providerDownloadContentTypeIsWrong, true);
    // sourceUrl is a real web page and must keep pointing at Jamendo.
    assert.equal(asset.sourceUrl, "https://www.jamendo.com/track/1325220");
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.jamendo.clientId = previousClientId;
  }
});

test("a track that disallows download exposes no media URL", async () => {
  const previousFetch = globalThis.fetch;
  const previousClientId = config.credentials.jamendo.clientId;
  config.credentials.jamendo.clientId = "test-client-id";

  globalThis.fetch = async () => new Response(JSON.stringify({
    headers: { status: "success" },
    results: [{ id: 999, name: "Locked", artist_name: "X", audiodownload_allowed: false, shareurl: "https://www.jamendo.com/track/999" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const [asset] = await jamendoProvider.search({ query: "x", assetType: "music", keywords: [] }, 1);
    assert.equal(asset.mediaUrl, null);
    assert.equal(asset.mediaContentType, null);
    assert.equal(asset.metadata.rawDownloadUrl, null);
    assert.equal(asset.metadata.providerDownloadUrl, null);
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.jamendo.clientId = previousClientId;
  }
});
