import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";

test("A2MCP manifest exposes ZitoAI as a free ASP service provider", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.mode, "standardized_api_service");
  assert.equal(manifest.billing.paymentRequired, false);
  assert.equal(manifest.billing.x402, false);
  assert.equal(manifest.billing.settlement, "instant_per_call_free");
  assert.equal(manifest.services.length, 2);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(manifest.services[0].serviceMode, "A2MCP");
  assert.equal(manifest.services[0].paymentRequired, false);
  assert.equal(manifest.services[0].settlement, "instant_per_call_free");
  assert.deepEqual(manifest.services[0].inputSchema.required, ["query"]);
  assert.deepEqual(manifest.providers, {
    image: "Shutterstock",
    sound_effect: "Freesound",
    music: "Jamendo",
  });
});

test("A2MCP result wrapper marks hackathon endpoints as free", () => {
  const wrapped = wrapA2McpResult("rights-media-search", { count: 0 });

  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.asp, "ZitoAI");
  assert.equal(wrapped.serviceId, "rights-media-search");
  assert.equal(wrapped.billing.paymentRequired, false);
  assert.deepEqual(wrapped.result, { count: 0 });
});

test("A2MCP manifest switches media-search to x402 pay-per-call when payment is enabled", () => {
  const previous = {
    enabled: config.payment.enabled,
    priceUsd: config.payment.priceUsd,
    network: config.payment.network,
  };

  try {
    config.payment.enabled = true;
    config.payment.priceUsd = "$0.02";
    config.payment.network = "eip155:196";

    const manifest = buildA2McpManifest();
    assert.equal(manifest.billing.paymentRequired, true);
    assert.equal(manifest.billing.x402, true);
    assert.equal(manifest.billing.price, "$0.02");
    assert.equal(manifest.services[0].id, "rights-media-search");
    assert.equal(manifest.services[0].paymentRequired, true);
    assert.equal(manifest.services[0].pricingType, "pay_per_call");
    assert.equal(manifest.services[0].network, "eip155:196");
    assert.equal(manifest.services[1].paymentRequired, false);
  } finally {
    config.payment.enabled = previous.enabled;
    config.payment.priceUsd = previous.priceUsd;
    config.payment.network = previous.network;
  }
});
