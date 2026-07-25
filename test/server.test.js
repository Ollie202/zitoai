// HTTP-surface tests. The server module starts listening on import, so each test drives
// the real server over a loopback port rather than mocking the handler.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.PORT = process.env.TEST_PORT || "3199";
process.env.RATE_LIMIT_MAX_REQUESTS = "5";
process.env.RATE_LIMIT_WINDOW_MS = "60000";

const { default: server } = await import("../src/server.js");
if (!server.listening) await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

// Preflight previously fell through to the payment gate and answered 402, which a
// browser reports as an opaque CORS failure — the real request was never sent.
test("CORS preflight is answered before the payment gate", async () => {
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

// Access-Control-Expose-Headers is inert without Allow-Origin, so an agent running in a
// browser could not read the challenge it is supposed to act on.
test("the 402 challenge is readable cross-origin", async () => {
  const response = await fetch(`${base}/api/a2mcp/media-search`, {
    headers: { Origin: "https://example.com" },
  });

  assert.equal(response.status, 402);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-expose-headers"), /PAYMENT-REQUIRED/);
  assert.ok(response.headers.get("payment-required"), "the challenge header must be present");
});

test("the 402 challenge decodes to a well-formed x402 offer", async () => {
  const response = await fetch(`${base}/api/a2mcp/media-search`);
  const decoded = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString("utf8"));

  assert.equal(decoded.x402Version, 1);
  assert.equal(decoded.accepts.length, 1);
  const [offer] = decoded.accepts;
  assert.equal(offer.scheme, "exact");
  assert.match(offer.network, /^eip155:\d+$/);
  assert.match(offer.payTo, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(offer.outputSchema.input.method, "POST");
  assert.deepEqual(offer.outputSchema.input.body.required, ["query"]);
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

test("static file serving refuses path traversal", async () => {
  for (const path of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/local.env"]) {
    const response = await fetch(`${base}${path}`);
    assert.ok(response.status === 403 || response.status === 404, `${path} must not be served (got ${response.status})`);
    const text = await response.text();
    assert.doesNotMatch(text, /OPENROUTER_API_KEY|"dependencies"/, `${path} leaked file contents`);
  }
});

test("health reports the models actually in use", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.brain.models.parseBrief, "health must name the parse model");
  assert.ok(body.brain.models.rankResults, "health must name the ranking model");
  assert.equal(body.payment.amount, "0");
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
});
