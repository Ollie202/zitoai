import { config } from "../config.js";

export function paymentStatus() {
  return {
    mode: "free",
    price: "free",
    network: config.payment.network,
    payToConfigured: Boolean(config.payment.payToAddress),
    facilitatorBaseUrl: config.payment.baseUrl,
    configured: false,
    x402Active: false,
  };
}

export function a2mcpBilling() {
  return {
    type: "free",
    paymentRequired: false,
    x402: false,
    settlement: "none",
    price: "free",
    pricingType: "free",
    note: "Free A2MCP mode is active. Calls to the public media-search endpoint return results directly.",
  };
}
