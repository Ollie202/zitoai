// HTTP-surface tests. The server module starts listening on import, so each test drives
// the real server over a loopback port rather than mocking the handler.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.PORT = process.env.TEST_PORT || "3199";
process.env.RATE_LIMIT_MAX_REQUESTS = "5";
process.env.RATE_LIMIT_WINDOW_MS = "60000";

const { default: server, errorStatus, clientErrorMessage } = await import("../src/server.js");
if (!server.listening) await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

test("CORS preflight is answered before the public A2MCP handler", async () => {
  const response = await fetch(`${base}/api/a2mcp/media-search`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-payment",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-headers"), /x-payment/i);
});

test("the free A2MCP endpoint never turns validation errors into a payment challenge", async () => {
  const response = await fetch(`${base}/api/a2mcp/media-search`, {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("payment-required"), null);
});

test("the manifest declares the public endpoint as free instead of zero-fee x402", async () => {
  const manifest = await (await fetch(`${base}/.well-known/a2mcp.json`)).json();
  assert.equal(manifest.billing.paymentRequired, false);
  assert.equal(manifest.billing.x402, false);
  assert.equal(manifest.billing.pricingType, "free");
  assert.equal(manifest.services[0].paymentRequired, false);
  assert.equal(manifest.services[0].x402, false);
});

test("payment headers are irrelevant to the free endpoint", async () => {
  const response = await fetch(`${base}/api/a2mcp/media-search`, {
    method: "POST",
    headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": "proof" },
    body: "{}",
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("payment-required"), null);
});

test("expensive routes are rate limited per client", async () => {
  const body = JSON.stringify({ asset: { id: "x", provider: "jamendo" } });
  const call = () => fetch(`${base}/api/evidence-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.42" },
    body,
  });

  const statuses = [];
  for (let index = 0; index < 7; index += 1) statuses.push((await call()).status);

  assert.equal(statuses.filter((status) => status === 200).length, 5, "the first five requests are served");
  assert.ok(statuses.includes(429), "the limit is enforced after the budget is spent");

  const limited = await call();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0, "429 must tell the caller when to retry");
});

test("rate limit buckets are per client, not global", async () => {
  const call = (ip) => fetch(`${base}/api/evidence-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ asset: { id: "y", provider: "jamendo" } }),
  });

  // 203.0.113.42 is already exhausted by the previous test; a different client is not.
  assert.equal((await call("198.51.100.7")).status, 200);
});

// Every unexpected error used to collapse to 400, which reported outages as client
// mistakes and made real failures hard to spot.
test("errors map to meaningful status codes", async () => {
  const malformed = await fetch(`${base}/api/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.8" },
    body: "not-json",
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.9" },
    body: "x".repeat(200_000),
  });
  assert.equal(oversized.status, 413);

  const unauthenticated = await fetch(`${base}/api/procurements`);
  assert.equal(unauthenticated.status, 401);

  const missing = await fetch(`${base}/api/does-not-exist`, { method: "POST" });
  assert.equal(missing.status, 404);
});

// The outage this guards against: a runtime failure carrying the words "not found" was
// matched by a loose rule and reported as 404, so a total breakage of every Supabase
// route looked like a routing mistake for weeks. Unrecognised faults must be 5xx, and
// their detail must never reach the caller.
test("an unrecognised runtime fault maps to 5xx, not 404", () => {
  const runtimeFaults = [
    "Node.js detected but native WebSocket not found.\n\nSuggested solution: Ensure you are running Node.js 22+",
    "Cannot read properties of undefined (reading 'id')",
    "fetch failed",
    "module not found",
  ];
  for (const message of runtimeFaults) {
    const status = errorStatus(new Error(message));
    assert.ok(status >= 500, `"${message.slice(0, 40)}" should be 5xx, got ${status}`);
    assert.doesNotMatch(clientErrorMessage(new Error(message)), /WebSocket|undefined|module/, "internal detail must not be echoed");
  }
});

test("recognised client mistakes keep their precise status", () => {
  assert.equal(errorStatus(new Error("Request body is too large")), 413);
  assert.equal(errorStatus(new Error("Request body must be valid JSON")), 400);
  assert.equal(errorStatus(new Error("Authentication required.")), 401);
  assert.equal(errorStatus(new Error("Invalid or expired session.")), 401);
  assert.equal(errorStatus(new Error("Procurement not found.")), 404);
  assert.equal(errorStatus(new Error("Evidence path does not belong to this procurement.")), 404);
  assert.equal(errorStatus(new Error("A search query is required.")), 400);
  assert.equal(errorStatus(new Error("Track id must be numeric.")), 400);
  assert.equal(errorStatus(new Error("Supabase is not configured.")), 503);

  // Messages that survive to the caller are the ones that tell them what to fix.
  assert.equal(clientErrorMessage(new Error("A search query is required.")), "A search query is required.");
});

// These routes act on ZitoAI's own Shutterstock account. Anonymous access meant any
// caller could read its subscription state or spend from a paid 500-download allotment.
test("routes that spend or expose the provider account require a session", async () => {
  const protectedRoutes = [
    ["GET", "/api/providers/shutterstock/subscriptions"],
    ["GET", "/api/providers/shutterstock/licenses"],
    ["GET", "/api/providers/shutterstock/images/123"],
    ["POST", "/api/providers/shutterstock/license"],
    ["POST", "/api/providers/shutterstock/licenses/abc/download"],
  ];

  for (const [method, path] of protectedRoutes) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.60" },
      body: method === "POST" ? JSON.stringify({ imageId: "1", confirmLicense: true }) : undefined,
    });
    assert.equal(response.status, 401, `${method} ${path} must reject an anonymous caller`);
    const body = await response.json();
    assert.match(body.error, /Authentication required/);
  }
});

test("the public taxonomy route stays open", async () => {
  // Categories are a static taxonomy, not account state, and the UI reads them freely.
  const response = await fetch(`${base}/api/providers/shutterstock/categories`);
  assert.notEqual(response.status, 401);
});

// The service is an ASP, not a website. With static serving removed there is no
// filesystem read reachable from a URL at all, which is a stronger guarantee than the
// traversal check that used to guard it.
test("no URL can reach the filesystem", async () => {
  const probes = [
    "/../package.json",
    "/..%2fpackage.json",
    "/%2e%2e/local.env",
    "/local.env",
    "/package.json",
    "/src/config.js",
    "/assets/zito-logo.png",
    // No page paths either — a service with no pages should not answer .html.
    "/index.html",
    "/about.html",
    "/styles.css",
  ];
  for (const path of probes) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, `${path} must not be served (got ${response.status})`);
    const text = await response.text();
    assert.doesNotMatch(text, /OPENROUTER_API_KEY|"dependencies"|SUPABASE/, `${path} leaked file contents`);
  }
});

test("the root returns a service descriptor, not a page", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/, "an ASP root must not serve HTML");

  const body = await response.json();
  assert.equal(body.role, "ASP");
  assert.equal(body.protocol, "A2MCP");
  assert.match(body.endpoints.mediaSearch, /\/api\/a2mcp\/media-search$/);
  assert.match(body.endpoints.agentCard, /\/\.well-known\/agent\.json$/);
  assert.match(body.endpoints.manifest, /\/\.well-known\/a2mcp\.json$/);
  assert.equal(body.billing.price, "0 USDT");
  assert.equal(body.billing.paymentRequired, false);
});

test("the endpoints the marketplace depends on all still answer", async () => {
  // Health check, agent card, A2MCP manifest and the media-search endpoint are the
  // surface OKX.AI actually uses. Removing the website must not touch any of them.
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/.well-known/agent.json`)).status, 200);
  assert.equal((await fetch(`${base}/.well-known/a2mcp.json`)).status, 200);
  assert.equal(
    (await fetch(`${base}/api/a2mcp/media-search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status,
    400,
  );
});

test("the browser bootstrap endpoint is gone", async () => {
  // /api/config existed only to hand the Supabase URL and anon key to the page.
  const response = await fetch(`${base}/api/config`);
  assert.equal(response.status, 404);
  const text = await response.text();
  assert.doesNotMatch(text, /anonKey|supabase\.co/i, "no key material may be published here");
});

test("health reports the models actually in use", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.brain.models.parseBrief, "health must name the parse model");
  assert.ok(body.brain.models.rankResults, "health must name the ranking model");
  assert.equal(body.payment.amount, "0");
  assert.equal(body.payment.authorization, "EIP-3009 transferWithAuthorization");
  // Settlement is the part that cannot work without OKX credentials, so health reports
  // whether it is actually wired rather than assuming it.
  assert.equal(typeof body.payment.facilitatorConfigured, "boolean");
});

test("the agent card and A2MCP manifest agree on the endpoint", async () => {
  const card = await (await fetch(`${base}/.well-known/agent.json`)).json();
  const manifest = await (await fetch(`${base}/.well-known/a2mcp.json`)).json();

  assert.equal(card.role, "ASP");
  const cardEndpoint = card.services[0].endpoint;
  const manifestEndpoint = manifest.services[0].endpoint;
  assert.equal(cardEndpoint, manifestEndpoint, "a mismatch here would break agent discovery");
  assert.match(manifestEndpoint, /\/api\/a2mcp\/media-search$/);
  assert.equal(manifest.services[0].method, "POST");
  assert.equal(card.services[0].paymentRequired, false);
  assert.equal(card.services[0].x402, false);
});

// These run the same provider search and return the same product as the A2MCP route, so
// an ungated one is a way around the gate rather than a separate feature.
test("the sibling search routes are behind the same authorization gate", async () => {
  // A fresh client per request: these paths are rate limited, and a 429 from a bucket an
  // earlier test drained would pass the "not 200" check without proving anything.
  let client = 20;
  const call = (path, headers) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Forwarded-For": `198.51.100.${client++}`, ...headers },
      body: JSON.stringify({ query: "rain" }),
    });

  for (const path of ["/api/search", "/api/agent/search"]) {
    const unsigned = await call(path);
    assert.equal(unsigned.status, 402, `${path} must not serve an unauthorized caller`);
    assert.ok(unsigned.headers.get("payment-required"), `${path} must answer with a challenge`);

    const junk = await call(path, { "PAYMENT-SIGNATURE": "proof" });
    assert.equal(junk.status, 402, `${path} must not accept an unsigned header`);
  }
});
