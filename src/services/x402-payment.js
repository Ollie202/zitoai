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

const SERVICE_DESCRIPTION = "ZitoAI rights aware media search";

export function buildX402Challenge(options = {}) {
  const resourceUrl = options.resource || `${config.aspBaseUrl.replace(/\/+$/, "")}/api/a2mcp/media-search`;
  const method = options.method || "POST";

  // Field order and shape follow the A2MCP v2 challenge template in the OKX docs. The
  // marketplace validates the base64 PAYMENT-REQUIRED header rather than the body, so
  // the header is what has to match.
  const accept = {
    scheme: "exact",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: String(config.payment.amount || "0"),
    payTo: getPayToAddress(),
    maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
    // The EIP-712 domain a payer needs to sign an EIP-3009
    // transferWithAuthorization. Omitting it meant no valid authorization could be
    // constructed, which is what a listing review caught. Verified against the token's
    // on-chain DOMAIN_SEPARATOR, and identical to the values in the OKX template.
    extra: {
      name: config.payment.assetName,
      version: config.payment.assetVersion,
    },
    // Beyond the template. maxAmountRequired keeps v1 readers working, and the scale is
    // stated so a client never has to infer it — a reviewer's client reported
    // "expected 0 USDT ~ ? minimal units" with nothing to convert from.
    maxAmountRequired: String(config.payment.amount || "0"),
    decimals: config.payment.assetDecimals,
    amountHuman: humanAmount(config.payment.amount, config.payment.assetDecimals),
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
    // v2 per the OKX A2MCP template. v1 carried the resource as a bare string on each
    // accepts entry; v2 lifts it to a top-level object, and the payer replies with
    // PAYMENT-SIGNATURE rather than X-PAYMENT. Both proof headers are still accepted so
    // a v1 client is not broken by the move.
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: SERVICE_DESCRIPTION,
      mimeType: "application/json",
    },
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

// Clients are told to read a PAYMENT-RESPONSE header after a successful replay for the
// status, amount and payer. The header was advertised in Access-Control-Expose-Headers
// but never actually sent, so a caller following the protocol found nothing there.
//
// The status is deliberately "no_settlement_required" rather than "settled": at a zero
// price nothing moves on chain, and reporting a settlement that did not happen would be
// worse than reporting none.
export function buildPaymentResponse(request) {
  const proof = decodePaymentProof(request);
  return {
    x402Version: 2,
    scheme: "exact",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: String(config.payment.amount || "0"),
    amountHuman: humanAmount(config.payment.amount, config.payment.assetDecimals),
    decimals: config.payment.assetDecimals,
    payTo: getPayToAddress(),
    payer: proof?.authorization?.from || null,
    nonce: proof?.authorization?.nonce || null,
    transaction: null,
    status: "no_settlement_required",
    note: "Zero-fee service. The authorization was accepted and no transfer was settled on chain.",
  };
}

export function paymentResponseHeaders(request) {
  const encoded = Buffer.from(JSON.stringify(buildPaymentResponse(request)), "utf8").toString("base64");
  return { "PAYMENT-RESPONSE": encoded };
}

// Reads the payer's proof out of whichever header they used. Never throws: a malformed
// or absent proof simply yields null, because this only enriches the response and must
// not be able to fail the request.
function decodePaymentProof(request) {
  const raw = getHeader(request, "payment-signature") || getHeader(request, "x-payment") || getHeader(request, "payment") || "";
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(raw), "base64").toString("utf8"));
    // v2 nests the proof under `payload`; v1 carries it at the top level.
    return decoded?.payload?.authorization ? decoded.payload : decoded;
  } catch {
    return null;
  }
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

// Minimal units to a decimal string, without floating point. A zero price must render as
// "0" rather than an empty or unknown value, since that is the case a client is most
// likely to choke on.
function humanAmount(minimalUnits, decimals) {
  const raw = String(minimalUnits ?? "0").trim();
  if (!/^\d+$/.test(raw)) return "0";
  const scale = Number.isInteger(decimals) && decimals >= 0 ? decimals : 0;
  if (scale === 0) return raw;

  const padded = raw.padStart(scale + 1, "0");
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function getPayToAddress() {
  return config.payment.payToAddress || DEFAULT_ZITOAI_PAY_TO_ADDRESS;
}

function getHeader(request, name) {
  if (typeof request.headers?.get === "function") return request.headers.get(name);
  return request.headers?.[name.toLowerCase()] || request.headers?.[name] || "";
}
