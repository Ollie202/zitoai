import { config } from "../config.js";

export const DEFAULT_ZITOAI_PAY_TO_ADDRESS = "0x9e9504c24681860835865bfb32db139527fef259";

export function paymentStatus() {
  return {
    mode: "x402_zero_fee",
    price: config.payment.priceUsd || "0 USDT",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: config.payment.amount,
    payToAddress: getPayToAddress(),
    payToConfigured: Boolean(config.payment.payToAddress),
    facilitatorBaseUrl: config.payment.baseUrl,
    configured: true,
    x402Active: true,
  };
}

export function a2mcpBilling() {
  return {
    type: "x402",
    paymentRequired: true,
    x402: true,
    settlement: "OKX Agent Payments Protocol",
    price: config.payment.priceUsd || "0 USDT",
    pricingType: "per_call",
    amount: config.payment.amount,
    asset: config.payment.assetAddress,
    network: config.payment.network,
    note: "Zero-fee x402 mode is active. Unpaid calls receive a 402 challenge with a 0-amount accepts entry, then pay-and-replay returns the media-search result.",
  };
}

export function buildX402Challenge(options = {}) {
  const resource = options.resource || `${config.aspBaseUrl.replace(/\/+$/, "")}/api/a2mcp/media-search`;
  const method = options.method || "POST";
  const accept = {
    scheme: "exact",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: String(config.payment.amount || "0"),
    maxAmountRequired: String(config.payment.amount || "0"),
    payTo: getPayToAddress(),
    resource,
    description: "ZitoAI rights aware media search",
    mimeType: "application/json",
    outputSchema: {
      input: {
        type: "http",
        method,
        bodyType: "json",
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            assetType: { type: "string", enum: ["image", "sound_effect", "music"] },
            intendedUse: { type: "string" },
            territory: { type: "string" },
            budgetUsd: { type: "number" },
            limit: { type: "number" },
          },
        },
      },
    },
  };

  return {
    x402Version: 1,
    error: "Payment required",
    accepts: [accept],
  };
}

export function x402ChallengeHeaders(challenge) {
  const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
  return {
    "PAYMENT-REQUIRED": encoded,
    "WWW-Authenticate": "Payment",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, WWW-Authenticate",
  };
}

export function hasX402PaymentProof(request) {
  const authorization = getHeader(request, "authorization") || "";
  return Boolean(
    getHeader(request, "x-payment") ||
      getHeader(request, "payment-signature") ||
      getHeader(request, "payment") ||
      authorization.toLowerCase().startsWith("payment "),
  );
}

function getPayToAddress() {
  return config.payment.payToAddress || DEFAULT_ZITOAI_PAY_TO_ADDRESS;
}

function getHeader(request, name) {
  if (typeof request.headers?.get === "function") return request.headers.get(name);
  return request.headers?.[name.toLowerCase()] || request.headers?.[name] || "";
}
