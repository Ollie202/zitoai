import { createServer } from "node:http";
import { config } from "./config.js";
import { publicProviderInfo } from "./providers/index.js";
import { buildA2McpManifest, wrapA2McpResult } from "./services/a2mcp.js";
import { buildX402Challenge, hasX402PaymentProof, paymentStatus, x402ChallengeHeaders } from "./services/x402-payment.js";
import { brainStatus, normalizeBrief, restoreSpendFromStore } from "./services/openrouter.js";
import { searchAssets } from "./services/search-service.js";
import { buildEvidenceManifest, buildEvidencePdf, evidenceHash } from "./services/evidence-pack.js";
import { completeOAuth, oauthStatus, startOAuth } from "./services/oauth.js";
import { downloadFreesoundOriginal, freesoundStatus, getFreesoundMe } from "./services/freesound.js";
import { jamendoStatus } from "./services/jamendo.js";
import { jamendoTrackId, streamJamendoDownload } from "./services/jamendo-download.js";
import { hitSharedRateLimit, pruneUsageCounters, usageStoreStatus } from "./services/usage-store.js";
import {
  getShutterstockImageDetails,
  licenseShutterstockImage,
  listShutterstockImageLicenses,
  listShutterstockImageCategories,
  listShutterstockSubscriptions,
  redownloadShutterstockImage,
  shutterstockStatus,
} from "./services/shutterstock.js";
import {
  authenticatedUser,
  createEvidenceUpload,
  createProcurement,
  getProcurement,
  listProcurements,
  listProviderConnections,
  recordPurchase,
  registerEvidence,
  storageStatus,
} from "./services/supabase.js";

// ZitoAI is an ASP on OKX.AI, not a website. The origin serves the A2MCP endpoint, the
// agent card and the manifest — nothing else. Root answers with a machine-readable
// descriptor so an agent landing here is pointed at the right places, and there is no
// static file surface to secure, cache or keep in sync.
const serviceDescriptor = () => ({
  service: "zitoai",
  role: "ASP",
  protocol: "A2MCP",
  description: "Rights-aware media search. Finds licensable images, sound effects, music tracks and ambience, and returns them with the licensing metadata an agent needs to act.",
  endpoints: {
    mediaSearch: `${config.aspBaseUrl.replace(/\/+$/, "")}/api/a2mcp/media-search`,
    agentCard: `${config.aspBaseUrl.replace(/\/+$/, "")}/.well-known/agent.json`,
    manifest: `${config.aspBaseUrl.replace(/\/+$/, "")}/.well-known/a2mcp.json`,
    health: `${config.aspBaseUrl.replace(/\/+$/, "")}/api/health`,
  },
  payment: {
    protocol: "OKX Agent Payments Protocol",
    price: paymentStatus().price,
    note: "Unpaid requests receive a 402 challenge. Complete the pay-and-replay handshake, then POST the request again.",
  },
});

const agentCard = {
  name: "ZitoAI",
  description: "Finds licensable media, screens provider-specific usage rules, and produces verifiable License Evidence Packs.",
  version: "0.1.0",
  url: config.aspBaseUrl,
  websiteUrl: config.publicBaseUrl,
  role: "ASP",
  protocol: "A2MCP",
  capabilities: { streaming: false, pushNotifications: false, a2mcp: true },
  services: [
    {
      id: "rights-media-search",
      name: "Rights-aware media search",
      endpoint: `${config.aspBaseUrl}/api/a2mcp/media-search`,
      price: paymentStatus().price,
      paymentRequired: true,
      x402: true,
      description: "Zero-fee x402 access to rights-aware search across licensable images, sound effects, music tracks, and ambience.",
    },
  ],
  safety: { paymentRequiresUserConfirmation: false, legalAdvice: false },
};

// Search routes call OpenRouter and the licensing providers, so they cost real quota on
// every hit. Cheap metadata routes are exempt.
const RATE_LIMITED_PREFIXES = ["/api/search", "/api/agent/search", "/api/brief", "/api/a2mcp/media-search", "/api/evidence-pack"];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    // Applied to every response, including 402 and error paths, so a browser client can
    // read the challenge instead of seeing an opaque CORS failure.
    for (const [name, value] of Object.entries(corsHeaders(request))) {
      response.setHeader(name, value);
    }

    // Preflight has to answer before any auth or payment gate, otherwise browsers see
    // the 402 as a CORS failure and never send the real request.
    if (request.method === "OPTIONS") {
      response.writeHead(204, securityHeaders({ "Content-Length": "0" }));
      return response.end();
    }

    if (RATE_LIMITED_PREFIXES.some((prefix) => url.pathname === prefix)) {
      const limit = await enforceRateLimit(request);
      if (!limit.ok) {
        return json(response, 429, {
          error: "Too many requests. Please retry shortly.",
          retryAfterSeconds: limit.retryAfterSeconds,
        }, { "Retry-After": String(limit.retryAfterSeconds) });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        service: "zitoai",
        version: "0.1.0",
        brain: brainStatus(),
        storage: storageStatus(),
        usage: usageStoreStatus(),
        oauth: oauthStatus(),
        payment: paymentStatus(),
      });
    }
    // /api/config is gone with the browser UI. It existed only to hand the Supabase URL
    // and anon key to a page that no longer exists, and an endpoint that publishes keys
    // to nobody is surface without a purpose.
    if (request.method === "GET" && url.pathname === "/api/providers") {
      return json(response, 200, { providers: publicProviderInfo() });
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/status") {
      return json(response, 200, shutterstockStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/freesound/status") {
      return json(response, 200, freesoundStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/jamendo/status") {
      return json(response, 200, jamendoStatus());
    }
    const jamendoDownloadMatch = url.pathname.match(/^\/api\/providers\/jamendo\/tracks\/([^/]+)\/download$/i);
    if (jamendoDownloadMatch) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json(response, 405, { error: "Use GET to download a Jamendo track." });
      }
      const trackId = jamendoTrackId(jamendoDownloadMatch[1]);
      if (!trackId) return json(response, 400, { error: "Track id must be numeric." });
      const limit = checkRateLimit(request);
      if (!limit.ok) {
        return json(response, 429, { error: "Too many requests. Please retry shortly.", retryAfterSeconds: limit.retryAfterSeconds }, { "Retry-After": String(limit.retryAfterSeconds) });
      }
      // Awaited, not returned bare: `return promise` inside a try block does not await,
      // so a rejection would escape this handler's catch, hang the connection, and take
      // the process down as an unhandled rejection.
      return await streamJamendoDownload(trackId, response, securityHeaders({}));
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/categories") {
      return json(response, 200, await listShutterstockImageCategories());
    }
    // The routes below act on ZitoAI's own Shutterstock account: they read its
    // subscription state or spend from its download allotment. Left anonymous, any
    // caller could drain a paid allotment or read the account's licensing history, so
    // each one requires a signed-in user.
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/subscriptions") {
      await authenticatedUser(request);
      return json(response, 200, await listShutterstockSubscriptions());
    }
    const shutterstockImageMatch = url.pathname.match(/^\/api\/providers\/shutterstock\/images\/([^/]+)$/i);
    if (request.method === "GET" && shutterstockImageMatch) {
      await authenticatedUser(request);
      return json(response, 200, await getShutterstockImageDetails(shutterstockImageMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/licenses") {
      await authenticatedUser(request);
      return json(response, 200, await listShutterstockImageLicenses(Object.fromEntries(url.searchParams)));
    }
    if (request.method === "POST" && url.pathname === "/api/providers/shutterstock/license") {
      // This one spends real money. Authenticated, and rate limited on top, because a
      // single signed-in account should not be able to burn the allotment in a loop.
      await authenticatedUser(request);
      const limit = await enforceRateLimit(request);
      if (!limit.ok) {
        return json(response, 429, { error: "Too many licensing requests. Please retry shortly.", retryAfterSeconds: limit.retryAfterSeconds }, { "Retry-After": String(limit.retryAfterSeconds) });
      }
      return json(response, 201, { license: await licenseShutterstockImage(await readJson(request)) });
    }
    const freesoundDownloadMatch = url.pathname.match(/^\/api\/providers\/freesound\/sounds\/([0-9]+)\/download$/i);
    if (request.method === "POST" && freesoundDownloadMatch) {
      return json(response, 201, { download: await downloadFreesoundOriginal(request, freesoundDownloadMatch[1]) });
    }
    if (request.method === "GET" && url.pathname === "/api/providers/freesound/me") {
      return json(response, 200, await getFreesoundMe(request));
    }
    const shutterstockRedownloadMatch = url.pathname.match(/^\/api\/providers\/shutterstock\/licenses\/([^/]+)\/download$/i);
    if (request.method === "POST" && shutterstockRedownloadMatch) {
      await authenticatedUser(request);
      return json(response, 201, { download: await redownloadShutterstockImage({ ...(await readJson(request)), licenseId: shutterstockRedownloadMatch[1] }) });
    }
    if (request.method === "GET" && ["/api/agent", "/.well-known/agent.json", "/.well-known/agent-card.json"].includes(url.pathname)) {
      return json(response, 200, agentCard);
    }
    if (request.method === "GET" && ["/api/a2mcp", "/api/a2mcp/manifest", "/.well-known/a2mcp.json"].includes(url.pathname)) {
      return json(response, 200, buildA2McpManifest());
    }
    if (request.method === "GET" && url.pathname === "/api/oauth/connections") {
      return json(response, 200, { connections: await listProviderConnections(request) });
    }
    if (request.method === "POST" && url.pathname === "/api/brief") {
      return json(response, 200, await normalizeBrief(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/search") {
      return json(response, 200, await searchAssets(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/agent/search") {
      return json(response, 200, { ...(await searchAssets(await readJson(request))), agent: "ZitoAI", role: "ASP", protocol: "A2MCP", paymentRequired: true, x402: true });
    }
    if (url.pathname === "/api/a2mcp/media-search") {
      if (!hasX402PaymentProof(request)) {
        const challenge = buildX402Challenge({
          resource: `${config.aspBaseUrl.replace(/\/+$/, "")}/api/a2mcp/media-search`,
          method: "POST",
        });
        return json(response, 402, challenge, x402ChallengeHeaders(challenge));
      }
      if (request.method !== "POST") {
        return json(response, 405, { error: "Use POST with a JSON body after completing the x402 pay-and-replay handshake." });
      }
      const body = wrapA2McpResult("rights-media-search", await searchAssets(await readJson(request)));
      return json(response, 200, body);
    }
    if (request.method === "POST" && url.pathname === "/api/a2mcp/evidence-manifest") {
      return json(response, 200, wrapA2McpResult("license-evidence-manifest", buildEvidenceManifest(await readJson(request))));
    }
    if (request.method === "POST" && url.pathname === "/api/evidence-pack") {
      const manifest = buildEvidenceManifest(await readJson(request));
      if (url.searchParams.get("format") === "pdf") {
        const pdf = await buildEvidencePdf(manifest);
        return binary(response, 200, pdf, "application/pdf", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.pdf`, evidenceHash(pdf));
      }
      const body = Buffer.from(JSON.stringify(manifest, null, 2));
      return binary(response, 200, body, "application/json; charset=utf-8", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.json`, manifest.manifestSha256);
    }
    const oauthStartMatch = url.pathname.match(/^\/api\/oauth\/([a-z0-9_-]+)\/start$/i);
    if (request.method === "POST" && oauthStartMatch) {
      return json(response, 200, await startOAuth(request, oauthStartMatch[1]));
    }
    // The provider redirects a browser here at the end of its consent flow, so this one
    // route is reached by a human. It answers with JSON rather than bouncing to a static
    // page, because there is no longer a page to bounce to.
    const oauthCallbackMatch = url.pathname.match(/^\/auth\/([a-z0-9_-]+)\/callback$/i);
    if (request.method === "GET" && oauthCallbackMatch) {
      try {
        const result = await completeOAuth(oauthCallbackMatch[1], Object.fromEntries(url.searchParams));
        return json(response, 200, {
          ok: true,
          provider: result.provider,
          expiresAt: result.expiresAt,
          message: `${result.provider} account connected. You can close this window.`,
        });
      } catch (error) {
        return json(response, 400, {
          ok: false,
          error: error.message,
          message: "The provider connection could not be completed. You can close this window and try again.",
        });
      }
    }
    if (request.method === "GET" && url.pathname === "/api/procurements") {
      return json(response, 200, { procurements: await listProcurements(request) });
    }
    if (request.method === "POST" && url.pathname === "/api/procurements") {
      return json(response, 201, { procurement: await createProcurement(request, await readJson(request)) });
    }
    const procurementMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && procurementMatch) {
      return json(response, 200, { procurement: await getProcurement(request, procurementMatch[1]) });
    }
    const purchaseMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/purchase$/i);
    if (request.method === "POST" && purchaseMatch) {
      return json(response, 201, { result: await recordPurchase(request, purchaseMatch[1], await readJson(request)) });
    }
    const uploadMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/evidence\/upload$/i);
    if (request.method === "POST" && uploadMatch) {
      return json(response, 201, { upload: await createEvidenceUpload(request, uploadMatch[1], await readJson(request)) });
    }
    const evidenceMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/evidence$/i);
    if (request.method === "POST" && evidenceMatch) {
      return json(response, 201, { evidence: await registerEvidence(request, evidenceMatch[1], await readJson(request)) });
    }
    // Anything landing on the origin root gets pointed at the endpoints that matter,
    // rather than a page. There is no static file surface behind this.
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return json(response, 200, serviceDescriptor());
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    // A streaming route may already have sent headers; writing a second response would
    // throw and mask the original failure.
    if (response.headersSent) {
      console.error("[zitoai] error after response started:", error?.message);
      return response.destroy();
    }
    return json(response, errorStatus(error), { error: clientErrorMessage(error) });
  }
});

// Distinguishes what the caller got wrong from what failed on our side. Everything used
// to collapse to 400, which hid real outages behind a client-error status.
function errorStatus(error) {
  const message = String(error?.message || "");
  if (message === "Request body is too large") return 413;
  if (message === "Request body must be valid JSON") return 400;
  if (/^Authentication required\.$|^Invalid or expired session\.$/.test(message)) return 401;
  // Anchored to the messages this service actually raises. A loose "not found" match
  // once reported a missing WebSocket global as a 404, hiding a real runtime failure
  // behind a client-error status.
  if (/^Procurement not found\.$|does not belong to this procurement/.test(message)) return 404;
  // A missing credential is an operator problem, not a caller mistake.
  if (/is not configured\.?$/i.test(message)) return 503;
  if (/^A search query is required|Track id must be numeric|must be valid JSON|Unsupported OAuth provider/i.test(message)) return 400;
  // Shutterstock request validation: the caller can fix all of these.
  if (/^Set confirmLicense=true|^Shutterstock (imageId|customerId|licenseId|price)|^Custom Shutterstock image licenses require|^No active Shutterstock image subscription/i.test(message)) return 400;
  if (error?.status && Number.isInteger(error.status)) return error.status >= 500 ? 502 : error.status;
  return 500;
}

// Upstream provider errors can carry vendor detail that should not be echoed verbatim to
// an anonymous caller. Known-safe validation messages pass through; anything else is
// logged server-side and reported generically.
function clientErrorMessage(error) {
  const message = String(error?.message || "Unexpected error");
  const status = errorStatus(error);
  if (status < 500) return message;
  console.error("[zitoai] unhandled request error:", message);
  if (status === 503) return "A required upstream service is not configured. Please try again later.";
  return "The service could not complete this request. Please try again.";
}

// Node terminates the process on an unhandled rejection by default. For a single-
// instance service that turns one missed `await` into an outage, so these are logged
// loudly and survived instead. An uncaughtException leaves the process in an unknown
// state, so that one closes the listener and exits for the platform to restart.
process.on("unhandledRejection", (reason) => {
  console.error("[zitoai] unhandled rejection:", reason instanceof Error ? reason.stack : reason);
});

process.on("uncaughtException", (error) => {
  console.error("[zitoai] uncaught exception, shutting down:", error?.stack || error);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[zitoai] ${signal} received, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

// Expired rate-limit windows are cleared periodically rather than on the request path.
// unref() so this timer never holds the process open during shutdown.
const usagePruneTimer = setInterval(() => {
  pruneUsageCounters().catch(() => {});
}, 60 * 60 * 1000);
usagePruneTimer.unref();

// @supabase/supabase-js needs a native WebSocket, which only exists from Node 22. On an
// older runtime every Supabase-backed route fails at client construction — the kind of
// mismatch that is invisible locally and total in production, so it is stated at boot.
const MINIMUM_NODE_MAJOR = 22;

function assertRuntimeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= MINIMUM_NODE_MAJOR) return;
  console.error(
    `[zitoai] WARNING: running Node ${process.versions.node}. Node ${MINIMUM_NODE_MAJOR}+ is required — ` +
    "@supabase/supabase-js needs a native WebSocket, so sign-in, procurement history and " +
    "evidence storage will fail on this runtime.",
  );
}

server.listen(config.port, async () => {
  console.log(`ZitoAI running at http://localhost:${config.port} on Node ${process.versions.node}`);
  assertRuntimeVersion();
  console.log(`OpenRouter: ${brainStatus().configured ? "configured" : "local fallback"}`);
  // Resumes the persisted spend total so a redeploy does not hand out a fresh budget.
  // Awaited here rather than at import time so a slow database never delays listening.
  const restored = await restoreSpendFromStore().catch(() => null);
  if (restored) console.log(`Restored OpenRouter spend total: $${Number(restored).toFixed(6)}`);
});

export default server;

// Exported for tests: the status mapping is the piece that once hid a total outage
// behind a 404.
export { errorStatus, clientErrorMessage };

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  }));
  response.end(JSON.stringify(body));
}

function binary(response, status, body, contentType, fileName, hash) {
  response.writeHead(status, securityHeaders({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Evidence-SHA256": hash,
    "Access-Control-Expose-Headers": "X-Evidence-SHA256",
  }));
  response.end(body);
}

const MAX_BODY_BYTES = 100_000;

// Once the body exceeds the limit the payload is dropped, but the request stream is
// still drained to a hard ceiling before rejecting. Throwing immediately left the client
// writing into a socket the server had already finished with, so the caller saw
// ECONNRESET instead of the 413. The drain ceiling stops that courtesy from becoming an
// unbounded read.
const MAX_DRAIN_BYTES = 5_000_000;

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  let oversized = false;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (oversized) {
      if (bytes > MAX_DRAIN_BYTES) {
        request.destroy();
        break;
      }
      continue;
    }
    if (bytes > MAX_BODY_BYTES) {
      oversized = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }

  if (oversized) throw new Error("Request body is too large");
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

// Static file serving is gone along with the browser UI. Removing it also removes the
// path-traversal surface that came with it: there is no filesystem read reachable from a
// URL any more.

function securityHeaders(headers) {
  return {
    ...headers,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  };
}

// The A2MCP endpoint is a public, unauthenticated, zero-fee API, so any origin may call
// it. Nothing here is cookie- or session-authenticated across origins: the Supabase
// routes take a Bearer token, so credentials are never sent ambiently and
// Allow-Credentials stays off.
function corsHeaders(request, headers = {}) {
  const requested = getHeader(request, "access-control-request-headers");
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requested || "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": [
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "WWW-Authenticate",
      "X-Evidence-SHA256",
      "Retry-After",
    ].join(", "),
  };
}

function getHeader(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value.join(", ") : value || "";
}

// Fixed-window counter keyed by client IP. Deliberately in-process: it is a cost guard
// for a single Railway instance, not a distributed quota. A shared store would be the
// next step if this ever runs multi-replica.
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);
const rateLimitBuckets = new Map();

// The in-memory window is always consulted, so a single replica keeps its fast local
// decision and the service still limits when the shared store is unreachable. When the
// shared backend is enabled it is authoritative, because it sees every replica.
async function enforceRateLimit(request) {
  const local = checkRateLimit(request);
  const shared = await hitSharedRateLimit(clientIp(request), rateLimitWindowMs, rateLimitMaxRequests);
  if (!shared) return local;
  if (!shared.ok) return { ok: false, retryAfterSeconds: shared.retryAfterSeconds };
  return local;
}

function checkRateLimit(request) {
  const now = Date.now();
  const key = clientIp(request);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    if (rateLimitBuckets.size > 5000) pruneRateLimitBuckets(now);
    return { ok: true };
  }

  bucket.count += 1;
  if (bucket.count > rateLimitMaxRequests) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

function pruneRateLimitBuckets(now) {
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}

// Railway and Vercel both terminate TLS upstream, so the socket address is the proxy.
// The left-most X-Forwarded-For entry is the original client.
function clientIp(request) {
  const forwarded = getHeader(request, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.socket?.remoteAddress || "unknown";
}
