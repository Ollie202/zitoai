import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";
import { buildX402Challenge, hasX402PaymentProof } from "../src/services/x402-payment.js";

test("A2MCP manifest exposes ZitoAI as a zero-fee x402 ASP service provider", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.mode, "standardized_api_service");
  assert.equal(manifest.billing.paymentRequired, true);
  assert.equal(manifest.billing.x402, true);
  assert.equal(manifest.billing.settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.services.length, 1);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(manifest.services[0].serviceMode, "A2MCP");
  assert.equal(manifest.services[0].paymentRequired, true);
  assert.equal(manifest.services[0].x402, true);
  assert.equal(manifest.services[0].settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.services[0].pricingType, "per_call");
  assert.equal(manifest.services[0].price, "0 USDT");
  assert.equal(manifest.safety.paymentRequiresUserConfirmation, false);
  assert.deepEqual(manifest.services[0].inputSchema.required, ["query"]);
  assert.deepEqual(manifest.providers, {
    image: "Shutterstock",
    sound_effect: "Freesound",
    music: "Jamendo",
  });
});

test("A2MCP result wrapper marks the route as x402 protected", () => {
  const wrapped = wrapA2McpResult("rights-media-search", { count: 0 });

  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.asp, "ZitoAI");
  assert.equal(wrapped.serviceId, "rights-media-search");
  assert.equal(wrapped.billing.paymentRequired, true);
  assert.equal(wrapped.billing.x402, true);
  assert.deepEqual(wrapped.result, { count: 0 });
});

test("x402 challenge contains the registered X Layer USDT zero-fee accept", () => {
  const challenge = buildX402Challenge({ resource: `${config.aspBaseUrl}/api/a2mcp/media-search` });

  assert.equal(challenge.x402Version, 1);
  assert.equal(challenge.accepts.length, 1);
  assert.equal(challenge.accepts[0].network, "eip155:196");
  assert.equal(challenge.accepts[0].asset, "0x779ded0c9e1022225f8e0630b35a9b54be713736");
  assert.equal(challenge.accepts[0].amount, "0");
  assert.equal(challenge.accepts[0].maxAmountRequired, "0");
  assert.equal(challenge.accepts[0].resource.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(challenge.accepts[0].outputSchema.input.method, "POST");
});

test("x402 payment proof detection works with Node server headers", () => {
  assert.equal(hasX402PaymentProof({ headers: {} }), false);
  assert.equal(hasX402PaymentProof({ headers: { "x-payment": "proof" } }), true);
  assert.equal(hasX402PaymentProof({ headers: { "payment-signature": "proof" } }), true);
});
