import { config } from "../config.js";

export const A2MCP_PROTOCOL_VERSION = "okx.ai.a2mcp.v1";

export function buildA2McpManifest() {
  const baseUrl = config.aspBaseUrl.replace(/\/+$/, "");
  return {
    protocol: A2MCP_PROTOCOL_VERSION,
    name: "ZitoAI",
    role: "ASP",
    serviceType: "A2MCP",
    mode: "standardized_api_service",
    description: "Deterministic rights-aware media procurement API for images, sound effects, ambience, one-shots, and music tracks.",
    baseUrl,
    websiteUrl: config.publicBaseUrl.replace(/\/+$/, ""),
    billing: {
      type: "free",
      paymentRequired: false,
      x402: false,
      settlement: "instant_per_call_free",
      note: "Hackathon endpoints are free deterministic A2MCP-style APIs. Paid x402 can be added after marketplace approval.",
    },
    services: [
      {
        id: "rights-media-search",
        name: "Rights-aware media search",
        method: "POST",
        endpoint: `${baseUrl}/api/a2mcp/media-search`,
        price: "0",
        pricingType: "free",
        serviceMode: "A2MCP",
        settlement: "instant_per_call_free",
        paymentRequired: false,
        description: "Takes a media brief and returns normalized provider candidates with preview URLs, license metadata, and the next licensing step.",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Plain-language media request." },
            assetType: { type: "string", enum: ["image", "sound_effect", "music"], description: "Optional target media type. If omitted, ZitoAI infers the scope from the natural-language request." },
            intendedUse: { type: "string", description: "Commercial, personal, broadcast, app/game, etc." },
            territory: { type: "string", default: "worldwide" },
            budgetUsd: { type: "number" },
            limit: { type: "number", default: 6 },
          },
        },
      },
      {
        id: "license-evidence-manifest",
        name: "License evidence manifest",
        method: "POST",
        endpoint: `${baseUrl}/api/a2mcp/evidence-manifest`,
        price: "0",
        pricingType: "free",
        serviceMode: "A2MCP",
        settlement: "instant_per_call_free",
        paymentRequired: false,
        description: "Builds a JSON evidence manifest from a selected provider asset and real purchase/license evidence supplied by the caller.",
        inputSchema: {
          type: "object",
          required: ["brief", "asset"],
          properties: {
            brief: { type: "object" },
            asset: { type: "object" },
            purchase: { type: "object" },
          },
        },
      },
    ],
    providers: {
      image: "Shutterstock",
      sound_effect: "Freesound",
      music: "Jamendo",
    },
    safety: {
      legalAdvice: false,
      paymentRequiresUserConfirmation: true,
      noFabricatedPurchases: true,
      providerLicenseControlsRights: true,
    },
  };
}

export function wrapA2McpResult(serviceId, result) {
  return {
    ok: true,
    protocol: A2MCP_PROTOCOL_VERSION,
    asp: "ZitoAI",
    serviceId,
    billing: { type: "free", paymentRequired: false, x402: false },
    result,
  };
}
