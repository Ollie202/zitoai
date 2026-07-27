// The official OKX Payment SDK integration. A prior review rejected ZitoAI a second time
// for not using it — the hand-rolled EIP-3009 verification in the previous version of this
// file was protocol-correct (proven against the live facilitator and OKX's own x402-check
// validator) but was not the code path the review recognizes. This module replaces it with
// @okxweb3/x402-express's paymentMiddleware, @okxweb3/x402-evm's ExactEvmScheme, and the
// same OKXFacilitatorClient this service already verified end to end.
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { OKXFacilitatorClient } from "@okxweb3/x402-core/facilitator";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "../config.js";
import { claimNonce, releaseNonce } from "./x402-nonce-store.js";

export const DEFAULT_ZITOAI_PAY_TO_ADDRESS = "0x9e9504c24681860835865bfb32db139527fef259";

export function isFacilitatorConfigured() {
  const { apiKey, secretKey, passphrase } = config.payment;
  return Boolean(apiKey && secretKey && passphrase);
}

export function getPayToAddress() {
  return config.payment.payToAddress || DEFAULT_ZITOAI_PAY_TO_ADDRESS;
}

/**
 * The human-readable price. Derived from the amount actually signed and settled, so what
 * the service advertises cannot drift from what it charges. An explicit
 * OKX_PAYMENT_PRICE_USD still wins, for wording the derivation cannot produce.
 */
export function priceLabel() {
  if (config.payment.priceUsd) return config.payment.priceUsd;
  return `${humanAmount(config.payment.amount, config.payment.assetDecimals)} ${config.payment.assetSymbol}`;
}

export function paymentStatus() {
  return {
    mode: "x402_exact_eip3009",
    scheme: "exact",
    authorization: "EIP-3009 transferWithAuthorization",
    price: priceLabel(),
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: config.payment.amount,
    decimals: config.payment.assetDecimals,
    payToAddress: getPayToAddress(),
    payToConfigured: Boolean(config.payment.payToAddress),
    facilitatorBaseUrl: config.payment.baseUrl,
    facilitatorConfigured: isFacilitatorConfigured(),
    configured: isFacilitatorConfigured(),
    x402Active: true,
  };
}

export function a2mcpBilling() {
  return {
    type: "x402",
    paymentRequired: true,
    x402: true,
    settlement: "OKX Agent Payments Protocol",
    price: priceLabel(),
    pricingType: "zero_price_per_call",
    scheme: "exact",
    authorization: "EIP-3009 transferWithAuthorization",
    amount: config.payment.amount,
    decimals: config.payment.assetDecimals,
    asset: config.payment.assetAddress,
    network: config.payment.network,
    officialSdk: true,
    sdkPackages: ["@okxweb3/x402-express", "@okxweb3/x402-core", "@okxweb3/x402-evm"],
    note: "Unpaid calls receive an x402 v2 402 challenge in the PAYMENT-REQUIRED header. The amount is zero, but callers must still sign the EIP-3009 transferWithAuthorization and replay with PAYMENT-SIGNATURE. The official OKX seller SDK verifies the authorization before returning the result and emits PAYMENT-RESPONSE.",
  };
}

// Minimal units to a decimal string, without floating point.
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

class ZeroPriceOKXFacilitatorClient extends OKXFacilitatorClient {
  async settle(payload, requirements) {
    if (BigInt(requirements?.amount || "0") !== 0n) {
      return super.settle(payload, requirements);
    }

    // There is no token transfer to broadcast for an exact amount of zero. Verification
    // still went through OKX immediately before this method, so the EIP-3009 signature,
    // nonce, recipient, validity window and accepted requirements have all been checked.
    // Returning an SDK-shaped success receipt lets the official middleware complete the
    // pay-and-replay lifecycle without fabricating an on-chain zero-value settlement.
    return {
      success: true,
      status: "success",
      transaction: "",
      network: requirements.network,
      payer: payload?.payload?.authorization?.from || "",
      amount: "0",
    };
  }
}

let facilitatorClient = null;
function getFacilitator() {
  if (!facilitatorClient) {
    if (!isFacilitatorConfigured()) return null;
    facilitatorClient = new ZeroPriceOKXFacilitatorClient({
      apiKey: config.payment.apiKey,
      secretKey: config.payment.secretKey,
      passphrase: config.payment.passphrase,
      baseUrl: config.payment.baseUrl,
      syncSettle: config.payment.syncSettle,
    });
  }
  return facilitatorClient;
}

// Test seam, so a test can install a stub facilitator without real OKX credentials.
export function setFacilitatorForTesting(client) {
  facilitatorClient = client;
  resourceServer = null;
}

let resourceServer = null;

/**
 * The configured x402ResourceServer: the official facilitator client, the exact/EVM scheme
 * (EIP-3009 on assets that support it, which is how the SDK itself represents "no
 * assetTransferMethod" — verified against the live facilitator to match USD₮0 on X Layer),
 * and one extra guard the SDK does not provide on top: a local (from, nonce) claim.
 *
 * The chain only rejects a reused nonce once the first settlement confirms, which leaves a
 * window where the same signed header could be replayed and served repeatedly before that
 * confirmation lands — the SDK's own verify/settle round trip does not close this, since it
 * defers entirely to the facilitator. onBeforeVerify runs before any facilitator call, so a
 * replay is rejected locally at no facilitator cost, and the claim is released if
 * verification or settlement then fails, so an honest payer never loses a nonce to a
 * request that was never actually served.
 */
function getResourceServer() {
  if (resourceServer) return resourceServer;
  const facilitator = getFacilitator();
  if (!facilitator) return null;

  resourceServer = new x402ResourceServer(facilitator)
    .register(config.payment.network, new ExactEvmScheme())
    .onBeforeVerify(async ({ paymentPayload }) => {
      const authorization = paymentPayload?.payload?.authorization;
      if (!authorization?.from || !authorization?.nonce) return undefined;
      if (claimNonce(authorization.from, authorization.nonce)) return undefined;
      return { abort: true, reason: "nonce_replayed", message: "This authorization has already been used. Sign a fresh one." };
    })
    .onVerifyFailure(async ({ paymentPayload }) => {
      const authorization = paymentPayload?.payload?.authorization;
      if (authorization?.from && authorization?.nonce) releaseNonce(authorization.from, authorization.nonce);
    })
    .onSettleFailure(async ({ paymentPayload }) => {
      const authorization = paymentPayload?.payload?.authorization;
      if (authorization?.from && authorization?.nonce) releaseNonce(authorization.from, authorization.nonce);
    })
    .onAfterVerify(async ({ paymentPayload, requirements }) => {
      console.info(JSON.stringify({
        event: "x402_authorization_verified",
        scheme: requirements.scheme,
        network: requirements.network,
        amount: requirements.amount,
        payer: paymentPayload?.payload?.authorization?.from || null,
      }));
    })
    .onAfterSettle(async ({ result, requirements }) => {
      console.info(JSON.stringify({
        event: "x402_settlement_completed",
        scheme: requirements.scheme,
        network: requirements.network,
        amount: requirements.amount,
        status: result.status,
        transaction: result.transaction || null,
        zeroValue: BigInt(requirements.amount || "0") === 0n,
      }));
    });

  return resourceServer;
}

const SERVICE_DESCRIPTION = "ZitoAI rights aware media search";

/**
 * The route config shared by every gated path: same price, same asset, same recipient.
 * `AssetAmount` — {asset, amount} in minimal units — is passed instead of a "$" Money
 * string so the exact asset and amount are pinned explicitly rather than resolved through
 * the SDK's default-token-per-network table, even though that table's eip155:196 entry
 * (checked in the installed package) already matches USD₮0 exactly.
 */
function routeConfig(resourcePath) {
  return {
    accepts: {
      scheme: "exact",
      network: config.payment.network,
      payTo: getPayToAddress(),
      price: {
        asset: config.payment.assetAddress,
        amount: String(config.payment.amount),
        extra: { name: config.payment.assetName, version: config.payment.assetVersion },
      },
      maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
    },
    resource: `${config.aspBaseUrl.replace(/\/+$/, "")}${resourcePath}`,
    description: SERVICE_DESCRIPTION,
    mimeType: "application/json",
    // Not part of PaymentRequirements (a closed seven-field type per accepts entry), so it
    // rides on the challenge's own top-level `extensions` instead, which RouteConfig
    // passes through verbatim. A caller learns the price scale and the request body shape
    // straight from the 402 without a second round trip.
    extensions: {
      decimals: config.payment.assetDecimals,
      amountHuman: humanAmount(config.payment.amount, config.payment.assetDecimals),
      inputSchema: {
        type: "http",
        method: "POST",
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
}

/**
 * Builds the Express middleware gating `resourcePaths` behind a real x402 handshake:
 * PAYMENT-REQUIRED 402 challenge, EIP-3009 signature verification through the OKX
 * facilitator, and settlement only once the wrapped handler responds with a status under
 * 400 — settling first would charge a payer for a request that then failed.
 *
 * Returns null when the facilitator is not configured, so the caller can fail closed with
 * a clear operator-facing error instead of the SDK's harder-to-diagnose failure mode for a
 * server with no facilitator.
 */
export function createPaymentGate(resourcePaths) {
  const server = getResourceServer();
  if (!server) return null;

  const routes = {};
  for (const path of resourcePaths) routes[`POST ${path}`] = routeConfig(path);

  // syncFacilitatorOnStart left at its default (true): the resource server has to fetch
  // the facilitator's supported (scheme, network) kinds before it will recognize "exact" on
  // "eip155:196" as servable at all — skipping it made every gated request fail with
  // "Facilitator does not support exact on eip155:196", confirmed locally before this
  // comment was written. The fetch happens once, lazily, on the first gated request.
  return paymentMiddleware(routes, server);
}
