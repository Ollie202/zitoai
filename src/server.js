import express from "express";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { publicProviderInfo } from "./providers/index.js";
import { a2mcpBilling, buildA2McpManifest, wrapA2McpResult } from "./services/a2mcp.js";
import { createPaymentGate, isFacilitatorConfigured, paymentStatus } from "./services/x402-sdk.js";
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
  billing: a2mcpBilling(),
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
      price: "0 USDT",
      pricingType: "free",
      paymentRequired: false,
      x402: false,
      description: "Free rights-aware search across licensable images, sound effects, music tracks, and ambience.",
    },
  ],
  safety: { paymentRequiresUserConfirmation: false, legalAdvice: false },
};

// These legacy search aliases are not the listed A2MCP service. They remain behind the
// payment gate so the only public free search surface is the registered endpoint below.
const GATED_PATHS = ["/api/search", "/api/agent/search"];

// Search routes call OpenRouter and the licensing providers, so they cost real quota on
// every hit. Cheap metadata routes are exempt.
const RATE_LIMITED_PREFIXES = ["/api/search", "/api/agent/search", "/api/brief", "/api/a2mcp/media-search", "/api/evidence-pack"];

const MAX_BODY_BYTES = 100_000;

const app = express();
app.disable("x-powered-by");
app.disable("etag");
app.set("query parser", "simple");
app.set("json spaces", 0);

app.use(securityHeaders);
app.use(corsMiddleware);
// Preflight has to answer before any auth or payment gate, otherwise browsers see the 402
// as a CORS failure and never send the real request.
app.options(/.*/, (req, res) => res.status(204).end());

app.use(express.json({ limit: MAX_BODY_BYTES, strict: false }));
// express.json() leaves req.body undefined for a request it did not parse (no body, or a
// non-JSON content type). Every handler below expects an object it can read fields off.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

app.use(async (req, res, next) => {
  if (!RATE_LIMITED_PREFIXES.includes(req.path)) return next();
  const limit = await enforceRateLimit(req);
  if (limit.ok) return next();
  res.set("Retry-After", String(limit.retryAfterSeconds));
  return json(res, 429, { error: "Too many requests. Please retry shortly.", retryAfterSeconds: limit.retryAfterSeconds });
});

app.get("/api/health", (req, res) => {
  json(res, 200, {
    ok: true,
    service: "zitoai",
    version: "0.1.0",
    brain: brainStatus(),
    storage: storageStatus(),
    usage: usageStoreStatus(),
    oauth: oauthStatus(),
    payment: paymentStatus(),
  });
});

// /api/config is gone with the browser UI. It existed only to hand the Supabase URL and
// anon key to a page that no longer exists, and an endpoint that publishes keys to nobody
// is surface without a purpose.
app.get("/api/providers", (req, res) => json(res, 200, { providers: publicProviderInfo() }));
app.get("/api/providers/shutterstock/status", (req, res) => json(res, 200, shutterstockStatus()));
app.get("/api/providers/freesound/status", (req, res) => json(res, 200, freesoundStatus()));
app.get("/api/providers/jamendo/status", (req, res) => json(res, 200, jamendoStatus()));

app.all("/api/providers/jamendo/tracks/:trackId/download", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Use GET to download a Jamendo track." });
  }
  const trackId = jamendoTrackId(req.params.trackId);
  if (!trackId) return json(res, 400, { error: "Track id must be numeric." });
  const limit = checkRateLimit(req);
  if (!limit.ok) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return json(res, 429, { error: "Too many requests. Please retry shortly.", retryAfterSeconds: limit.retryAfterSeconds });
  }
  await streamJamendoDownload(trackId, res, {});
});

app.get("/api/providers/shutterstock/categories", async (req, res) => json(res, 200, await listShutterstockImageCategories()));

// The routes below act on ZitoAI's own Shutterstock account: they read its subscription
// state or spend from its download allotment. Left anonymous, any caller could drain a
// paid allotment or read the account's licensing history, so each one requires a signed-in
// user.
app.get("/api/providers/shutterstock/subscriptions", async (req, res) => {
  await authenticatedUser(req);
  json(res, 200, await listShutterstockSubscriptions());
});
app.get("/api/providers/shutterstock/images/:imageId", async (req, res) => {
  await authenticatedUser(req);
  json(res, 200, await getShutterstockImageDetails(req.params.imageId));
});
app.get("/api/providers/shutterstock/licenses", async (req, res) => {
  await authenticatedUser(req);
  json(res, 200, await listShutterstockImageLicenses(req.query));
});
app.post("/api/providers/shutterstock/license", async (req, res) => {
  // This one spends real money. Authenticated, and rate limited on top, because a single
  // signed-in account should not be able to burn the allotment in a loop.
  await authenticatedUser(req);
  const limit = await enforceRateLimit(req);
  if (!limit.ok) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return json(res, 429, { error: "Too many licensing requests. Please retry shortly.", retryAfterSeconds: limit.retryAfterSeconds });
  }
  json(res, 201, { license: await licenseShutterstockImage(req.body) });
});
app.post("/api/providers/freesound/sounds/:soundId/download", async (req, res) => {
  if (!/^[0-9]+$/.test(req.params.soundId)) return json(res, 400, { error: "Freesound soundId must be numeric." });
  json(res, 201, { download: await downloadFreesoundOriginal(req, req.params.soundId) });
});
app.get("/api/providers/freesound/me", async (req, res) => json(res, 200, await getFreesoundMe(req)));
app.post("/api/providers/shutterstock/licenses/:licenseId/download", async (req, res) => {
  await authenticatedUser(req);
  json(res, 201, { download: await redownloadShutterstockImage({ ...req.body, licenseId: req.params.licenseId }) });
});

app.get(["/api/agent", "/.well-known/agent.json", "/.well-known/agent-card.json"], (req, res) => json(res, 200, agentCard));
app.get(["/api/a2mcp", "/api/a2mcp/manifest", "/.well-known/a2mcp.json"], (req, res) => json(res, 200, buildA2McpManifest()));
app.get("/api/oauth/connections", async (req, res) => json(res, 200, { connections: await listProviderConnections(req) }));
app.post("/api/brief", async (req, res) => json(res, 200, await normalizeBrief(req.body)));

// The x402 payment gate. Mounted with no path filter: app.use(path, fn) rebases req.url
// relative to the mount point for the duration of that middleware, and since these mount
// paths equal the full route paths exactly, the rebased req.url the SDK would see was "/"
// — invisible to its own internal "POST /api/a2mcp/media-search" route lookup, so it
// always concluded no payment was required and let every request through unauthorized.
// The SDK already scopes itself to exactly the routes passed to createPaymentGate, so a
// global mount is both correct and sufficient — it is a no-op on every other path.
//
// Missing credentials fail every gated route closed with a clear operator-facing error
// rather than serving unauthenticated, or failing in some SDK-internal way that is hard to
// diagnose from the outside.
const paymentGate = createPaymentGate(GATED_PATHS);
app.use((req, res, next) => {
  if (!GATED_PATHS.includes(req.path)) return next();
  if (paymentGate) return paymentGate(req, res, next);
  json(res, 503, {
    error: "settlement_unavailable",
    message: "The payment facilitator is not configured on this service. Set OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE.",
  });
});

app.post("/api/search", async (req, res) => json(res, 200, await searchAssets(req.body)));
app.post("/api/agent/search", async (req, res) =>
  json(res, 200, { ...(await searchAssets(req.body)), agent: "ZitoAI", role: "ASP", protocol: "A2MCP", paymentRequired: true, x402: true }),
);
app.post("/api/a2mcp/media-search", async (req, res) => {
  const requestId = requestTraceId(req);
  const startedAt = Date.now();
  logServiceEvent("a2mcp_media_search_started", {
    requestId,
    queryLength: String(req.body?.query || "").length,
    assetType: req.body?.assetType || null,
  });

  try {
    const result = await withDeadline(
      searchAssets(req.body),
      Number(process.env.A2MCP_SEARCH_TIMEOUT_MS || 45_000),
    );
    const durationMs = Date.now() - startedAt;
    logServiceEvent("a2mcp_media_search_succeeded", {
      requestId,
      durationMs,
      resultCount: result.count,
      recommendedProvider: result.recommendedProvider,
    });
    res.set("X-Request-Id", requestId);
    json(res, 200, wrapA2McpResult("rights-media-search", result));
  } catch (error) {
    logServiceEvent("a2mcp_media_search_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error?.message || "Unknown search failure",
    }, "error");
    throw error;
  }
});

app.post("/api/a2mcp/evidence-manifest", (req, res) =>
  json(res, 200, wrapA2McpResult("license-evidence-manifest", buildEvidenceManifest(req.body))),
);
app.post("/api/evidence-pack", async (req, res) => {
  const manifest = buildEvidenceManifest(req.body);
  if (req.query.format === "pdf") {
    const pdf = await buildEvidencePdf(manifest);
    return binary(res, 200, pdf, "application/pdf", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.pdf`, evidenceHash(pdf));
  }
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  binary(res, 200, body, "application/json; charset=utf-8", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.json`, manifest.manifestSha256);
});

app.post("/api/oauth/:provider/start", async (req, res) => {
  if (!isProviderSlug(req.params.provider)) return json(res, 400, { error: "Unsupported OAuth provider." });
  json(res, 200, await startOAuth(req, req.params.provider));
});

// The provider redirects a browser here at the end of its consent flow, so this one route
// is reached by a human. It answers with JSON rather than bouncing to a static page,
// because there is no longer a page to bounce to.
app.get("/auth/:provider/callback", async (req, res) => {
  if (!isProviderSlug(req.params.provider)) return json(res, 400, { error: "Unsupported OAuth provider." });
  try {
    const result = await completeOAuth(req.params.provider, req.query);
    json(res, 200, { ok: true, provider: result.provider, expiresAt: result.expiresAt, message: `${result.provider} account connected. You can close this window.` });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message, message: "The provider connection could not be completed. You can close this window and try again." });
  }
});

app.get("/api/procurements", async (req, res) => json(res, 200, { procurements: await listProcurements(req) }));
app.post("/api/procurements", async (req, res) => json(res, 201, { procurement: await createProcurement(req, req.body) }));
app.get("/api/procurements/:id", async (req, res) => {
  if (!isProcurementId(req.params.id)) return json(res, 404, { error: "Not found" });
  json(res, 200, { procurement: await getProcurement(req, req.params.id) });
});
app.post("/api/procurements/:id/purchase", async (req, res) => {
  if (!isProcurementId(req.params.id)) return json(res, 404, { error: "Not found" });
  json(res, 201, { result: await recordPurchase(req, req.params.id, req.body) });
});
app.post("/api/procurements/:id/evidence/upload", async (req, res) => {
  if (!isProcurementId(req.params.id)) return json(res, 404, { error: "Not found" });
  json(res, 201, { upload: await createEvidenceUpload(req, req.params.id, req.body) });
});
app.post("/api/procurements/:id/evidence", async (req, res) => {
  if (!isProcurementId(req.params.id)) return json(res, 404, { error: "Not found" });
  json(res, 201, { evidence: await registerEvidence(req, req.params.id, req.body) });
});

// Anything landing on the origin root gets pointed at the endpoints that matter, rather
// than a page. Only the root itself answers: an .html path has no meaning on a service
// with no pages, so it falls through to 404 like any other unknown route.
app.get("/", (req, res) => json(res, 200, serviceDescriptor()));

app.use((req, res) => json(res, 404, { error: "Not found" }));

// Express 5 forwards a rejected async handler here automatically. A streaming route may
// already have sent headers by the time it throws; writing a second response would throw
// again and mask the original failure.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    console.error("[zitoai] error after response started:", error?.message);
    return res.destroy();
  }
  json(res, errorStatus(error), { error: clientErrorMessage(error) });
});

// Distinguishes what the caller got wrong from what failed on our side. Everything used
// to collapse to 400, which hid real outages behind a client-error status.
function errorStatus(error) {
  const message = String(error?.message || "");
  // body-parser's own errors for a request express.json() could not accept.
  if (error?.type === "entity.too.large") return 413;
  if (error?.type === "entity.parse.failed") return 400;
  if (message === "Request body is too large") return 413;
  if (message === "Request body must be valid JSON") return 400;
  if (/^Authentication required\.$|^Invalid or expired session\.$/.test(message)) return 401;
  // Anchored to the messages this service actually raises. A loose "not found" match once
  // reported a missing WebSocket global as a 404, hiding a real runtime failure behind a
  // client-error status.
  if (/^Procurement not found\.$|does not belong to this procurement/.test(message)) return 404;
  // A missing credential is an operator problem, not a caller mistake.
  if (/is not configured\.?$/i.test(message)) return 503;
  if (/^A search query is required|Track id must be numeric|must be valid JSON|Unsupported OAuth provider/i.test(message)) return 400;
  // Shutterstock request validation: the caller can fix all of these.
  if (/^Set confirmLicense=true|^Shutterstock (imageId|customerId|licenseId|price)|^Custom Shutterstock image licenses require|^No active Shutterstock image subscription/i.test(message)) return 400;
  if (error?.code === "A2MCP_SEARCH_TIMEOUT") return 504;
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

const server = app.listen(config.port, async () => {
  console.log(`ZitoAI running at http://localhost:${config.port} on Node ${process.versions.node}`);
  assertRuntimeVersion();
  console.log(`OpenRouter: ${brainStatus().configured ? "configured" : "local fallback"}`);
  // Loud, because without it the paid endpoint cannot verify or settle anything and will
  // refuse every call — a failure worth seeing at boot rather than from the first payer.
  const payment = paymentStatus();
  console.log(
    isFacilitatorConfigured()
      ? `x402: exact/EIP-3009 via @okxweb3/x402-express, ${payment.price} per call, settling via ${config.payment.baseUrl}`
      : "x402: NOT CONFIGURED — set OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE or paid calls will fail",
  );
  // Real funds land here, so the receiving address is printed either way — and named as a
  // built-in default when PAY_TO_ADDRESS is unset, so a deployment that meant to override
  // it can see at a glance that it did not.
  console.log(`x402: paying to ${payment.payToAddress}${payment.payToConfigured ? "" : " (built-in default, PAY_TO_ADDRESS unset)"}`);
  // Resumes the persisted spend total so a redeploy does not hand out a fresh budget.
  // Awaited here rather than at import time so a slow database never delays listening.
  const restored = await restoreSpendFromStore().catch(() => null);
  if (restored) console.log(`Restored OpenRouter spend total: $${Number(restored).toFixed(6)}`);
});

// Node terminates the process on an unhandled rejection by default. For a single-instance
// service that turns one missed `await` into an outage, so these are logged loudly and
// survived instead. An uncaughtException leaves the process in an unknown state, so that
// one closes the listener and exits for the platform to restart.
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

export default server;

// Exported for tests: the status mapping is the piece that once hid a total outage behind
// a 404.
export { errorStatus, clientErrorMessage };

function json(res, status, body, extraHeaders = {}) {
  res.set(extraHeaders);
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
}

function binary(res, status, body, contentType, fileName, hash) {
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Evidence-SHA256": hash,
    "Access-Control-Expose-Headers": "X-Evidence-SHA256",
  });
  res.status(status).end(body);
}

// Static file serving is gone along with the browser UI. Removing it also removes the
// path-traversal surface that came with it: there is no filesystem read reachable from a
// URL any more.

// Express 5 dropped inline regex route constraints (path-to-regexp v8), so params are
// matched loosely by the router and validated here instead — same effect, same shape as
// the patterns these routes used before.
function isProviderSlug(value) {
  return /^[a-z0-9_-]+$/i.test(String(value || ""));
}
function isProcurementId(value) {
  return /^[0-9a-f-]+$/i.test(String(value || ""));
}

function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  next();
}

// The A2MCP endpoint is public and open to any origin. Nothing here is cookie- or
// session-authenticated across origins: the Supabase routes take a Bearer token, so
// credentials are never sent ambiently and Allow-Credentials stays off.
function corsMiddleware(req, res, next) {
  const requested = req.headers["access-control-request-headers"];
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requested || "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "WWW-Authenticate", "X-Evidence-SHA256", "X-Request-Id", "Retry-After"].join(", "),
  });
  next();
}

// Fixed-window counter keyed by client IP. Deliberately in-process: it is a cost guard for
// a single Railway instance, not a distributed quota. A shared store would be the next
// step if this ever runs multi-replica.
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);
const rateLimitBuckets = new Map();

// The in-memory window is always consulted, so a single replica keeps its fast local
// decision and the service still limits when the shared store is unreachable. When the
// shared backend is enabled it is authoritative, because it sees every replica.
async function enforceRateLimit(req) {
  const local = checkRateLimit(req);
  const shared = await hitSharedRateLimit(clientIp(req), rateLimitWindowMs, rateLimitMaxRequests);
  if (!shared) return local;
  if (!shared.ok) return { ok: false, retryAfterSeconds: shared.retryAfterSeconds };
  return local;
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
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

// Railway and Vercel both terminate TLS upstream, so the socket address is the proxy. The
// left-most X-Forwarded-For entry is the original client.
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function requestTraceId(req) {
  const supplied = req.headers["x-request-id"] || req.headers["x-railway-request-id"];
  return String(supplied || randomUUID()).slice(0, 128);
}

function logServiceEvent(event, fields, level = "log") {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "zitoai",
    event,
    ...fields,
  });
  console[level](entry);
}

async function withDeadline(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Media search timed out before a result was ready.");
          error.code = "A2MCP_SEARCH_TIMEOUT";
          error.status = 504;
          reject(error);
        }, Math.max(1_000, timeoutMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
