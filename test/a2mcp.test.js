import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";

test("A2MCP manifest exposes ZitoAI as a paid ASP service provider", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.mode, "standardized_api_service");
  assert.equal(manifest.billing.paymentRequired, true);
  assert.equal(manifest.billing.x402, true);
  assert.equal(manifest.billing.settlement, "instant_per_call_x402");
  assert.equal(manifest.services.length, 1);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(manifest.services[0].serviceMode, "A2MCP");
  assert.equal(manifest.services[0].paymentRequired, true);
  assert.equal(manifest.services[0].settlement, "instant_per_call_x402");
  assert.equal(manifest.services[0].pricingType, "pay_per_call");
  assert.equal(manifest.services[0].price, "$0.02");
  assert.deepEqual(manifest.services[0].inputSchema.required, ["query"]);
  assert.deepEqual(manifest.providers, {
    image: "Shutterstock",
    sound_effect: "Freesound",
    music: "Jamendo",
  });
});

test("A2MCP result wrapper marks the route as paid x402", () => {
  const wrapped = wrapA2McpResult("rights-media-search", { count: 0 });

  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.asp, "ZitoAI");
  assert.equal(wrapped.serviceId, "rights-media-search");
  assert.equal(wrapped.billing.paymentRequired, true);
  assert.equal(wrapped.billing.x402, true);
  assert.deepEqual(wrapped.result, { count: 0 });
});
