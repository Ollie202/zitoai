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

  // v2 per the OKX A2MCP template: the resource is a top-level object rather than a
  // bare string on each accepts entry.
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.resource.url, "https://asp.zitoai.xyz/api/a2mcp/media-search");
  assert.equal(challenge.resource.mimeType, "application/json");
  assert.ok(challenge.resource.description, "the resource names what is being sold");
  assert.equal(challenge.accepts.length, 1);
  assert.equal(challenge.accepts[0].network, "eip155:196");
  assert.equal(challenge.accepts[0].asset, "0x779ded0c9e1022225f8e0630b35a9b54be713736");
  assert.equal(challenge.accepts[0].amount, "0");
  assert.equal(challenge.accepts[0].maxAmountRequired, "0");
  // v1 repeated the resource as a bare string on every accepts entry; v2 states it once
  // at the top level, so the entry no longer carries it.
  assert.equal(challenge.accepts[0].resource, undefined);
  assert.equal(challenge.resource.url.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(challenge.accepts[0].outputSchema.input.method, "POST");
});

test("x402 payment proof detection works with Node server headers", () => {
  assert.equal(hasX402PaymentProof({ headers: {} }), false);
  assert.equal(hasX402PaymentProof({ headers: { "x-payment": "proof" } }), true);
  assert.equal(hasX402PaymentProof({ headers: { "payment-signature": "proof" } }), true);
});

// The listing was rejected because the challenge declared no EIP-712 domain, so no payer
// could construct an EIP-3009 transferWithAuthorization against it. `exact` carrying
// extra.name (and no permit2 marker) is what identifies EIP-3009 as the method.
test("the x402 challenge declares the EIP-3009 domain", () => {
  const [offer] = buildX402Challenge().accepts;

  assert.equal(offer.scheme, "exact");
  assert.ok(offer.extra, "an exact offer without extra cannot be signed as EIP-3009");
  assert.equal(offer.extra.name, "USD₮0", "EIP-712 domain name of the payment token");

  // Verified against the token's on-chain DOMAIN_SEPARATOR: recomputing it with
  // name "USD₮0" and version "1" reproduces 0xd591d9ba… exactly. The documented default
  // is "2", which would produce a signature that can never verify against this token.
  assert.equal(offer.extra.version, "1");

  // permit2 would select the wrong authorization method entirely.
  assert.notEqual(offer.extra.assetTransferMethod, "permit2");
});
