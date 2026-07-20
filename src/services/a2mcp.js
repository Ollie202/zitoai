import { a2mcpBilling } from "./x402-payment.js";
import { config } from "../config.js";

export const A2MCP_PROTOCOL_VERSION = "okx.ai.a2mcp.v1";

export function buildA2McpManifest() {
  const baseUrl = config.aspBaseUrl.replace(/\/+$/, "");
  const billing = a2mcpBilling();
  return {
    protocol: A2MCP_PROTOCOL_VERSION,
    name: "ZitoAI",
    role: "ASP",
    serviceType: "A2MCP",
    mode: "standardized_api_service",
    description: "Free rights-aware media search API for licensable images, sound effects, music tracks, and ambience.",
    baseUrl,
    websiteUrl: config.publicBaseUrl.replace(/\/+$/, ""),
    billing,
    services: [
      {
        id: "rights-media-search",
        name: "Rights-aware media search",
        method: "POST",
        endpoint: `${baseUrl}/api/a2mcp/media-search`,
        price: "free",
        pricingType: "free",
        serviceMode: "A2MCP",
        settlement: "none",
        paymentRequired: false,
        x402: false,
        description: "Provides free access to a rights-aware media search assistant. It takes a natural language request, understands the intended use, searches the right provider, filters the results by media type and usage fit, and returns strong matches with licensing details.",
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
    ],
    providers: {
      image: "Shutterstock",
      sound_effect: "Freesound",
      music: "Jamendo",
    },
    safety: {
      legalAdvice: false,
      paymentRequiresUserConfirmation: false,
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
    billing: a2mcpBilling(),
    result,
  };
}
