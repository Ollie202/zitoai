import test from "node:test";
import assert from "node:assert/strict";
import { buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";

test("A2MCP manifest exposes ZitoAI as a free ASP service provider", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.billing.paymentRequired, false);
  assert.equal(manifest.billing.x402, false);
  assert.equal(manifest.services.length, 2);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
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
