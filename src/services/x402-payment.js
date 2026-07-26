import { OKXFacilitatorClient } from "@okxweb3/x402-core/facilitator";
import { getAddress, verifyTypedData } from "viem";
import { config } from "../config.js";
import { claimNonce, releaseNonce } from "./x402-nonce-store.js";

export const DEFAULT_ZITOAI_PAY_TO_ADDRESS = "0x9e9504c24681860835865bfb32db139527fef259";

const SERVICE_DESCRIPTION = "ZitoAI rights aware media search";

// The EIP-3009 typed-data definition, verbatim from the standard and byte-identical to
// the one in @okxweb3/x402-evm. The payer signs this struct; we recover against the same
// definition, so any divergence here silently rejects every honest payment.
const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * The human-readable price. Derived from the amount that is actually signed and settled,
 * so what the service advertises cannot drift from what it charges. An explicit
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
    // Settlement is what makes this a payment rather than a formality, and it is the one
    // part that cannot work without credentials — so whether it is wired is reported
    // rather than assumed.
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
    pricingType: "per_call",
    scheme: "exact",
    authorization: "EIP-3009 transferWithAuthorization",
    amount: config.payment.amount,
    decimals: config.payment.assetDecimals,
    asset: config.payment.assetAddress,
    network: config.payment.network,
    note: "Unpaid calls receive an x402 v2 402 challenge in the PAYMENT-REQUIRED header. Sign the accepts entry as an EIP-3009 transferWithAuthorization, replay the request with PAYMENT-SIGNATURE, and the settled result is returned with a PAYMENT-RESPONSE receipt.",
  };
}

/**
 * The single `accepts` entry, carrying exactly the seven fields of the documented
 * PaymentRequirements type and nothing else.
 *
 * Anything extra used to live here — maxAmountRequired, decimals, amountHuman,
 * outputSchema. The marketplace validates this object, and a payer echoes it back as
 * `accepted` for the facilitator to check against, so unknown keys are risk with no
 * upside. The client-facing detail they carried now rides on the challenge's
 * `extensions`, which is where the type allows it.
 */
export function paymentRequirements() {
  return {
    scheme: "exact",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: String(config.payment.amount),
    payTo: getPayToAddress(),
    maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
    // Naming the EIP-712 domain and no transfer method is how the OKX SDK says
    // "EIP-3009": its exact-scheme server adds assetTransferMethod only for assets whose
    // method is not the EIP-3009 default, and USD₮0 is not one of them.
    extra: {
      name: config.payment.assetName,
      version: config.payment.assetVersion,
    },
  };
}

export function buildX402Challenge(options = {}) {
  const resourceUrl = options.resource || `${config.aspBaseUrl.replace(/\/+$/, "")}/api/a2mcp/media-search`;
  const method = options.method || "POST";

  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: SERVICE_DESCRIPTION,
      mimeType: "application/json",
    },
    error: "Payment required",
    accepts: [paymentRequirements()],
    // Not part of PaymentRequirements, so it is declared here instead of being smuggled
    // into the accepts entry. A caller still learns the price scale and the request body
    // straight from the challenge without a second round trip.
    extensions: {
      decimals: config.payment.assetDecimals,
      amountHuman: humanAmount(config.payment.amount, config.payment.assetDecimals),
      inputSchema: {
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
}

export function x402ChallengeHeaders(challenge) {
  const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
  return {
    "PAYMENT-REQUIRED": encoded,
    "WWW-Authenticate": "Payment",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, WWW-Authenticate",
  };
}

/**
 * Reads the payer's PaymentPayload off the request. v2 carries it in PAYMENT-SIGNATURE;
 * X-PAYMENT is the v1 header and is still read so an older client is not locked out.
 * Never throws — a malformed header is simply an absent payload, and the caller answers
 * with a fresh challenge.
 */
export function decodePaymentPayload(request) {
  const raw = getHeader(request, "payment-signature") || getHeader(request, "x-payment");
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(raw).trim(), "base64").toString("utf8"));
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Verifies an EIP-3009 authorization against what this service actually asked for.
 *
 * Order matters: everything checkable locally runs first, so a malformed or hostile
 * header costs no facilitator call, and the facilitator — which is authoritative on
 * balance and on-chain nonce state — is asked last.
 *
 * Returns a plain result rather than throwing, so the route can map each failure onto
 * its own status and reason instead of collapsing them into one error.
 */
export async function verifyPaymentAuthorization(request) {
  const payload = decodePaymentPayload(request);
  if (!payload) return failure("payment_required", "No PAYMENT-SIGNATURE header on the request.");

  const authorization = payload?.payload?.authorization;
  const signature = payload?.payload?.signature;
  if (!authorization || typeof authorization !== "object" || typeof signature !== "string") {
    return failure("invalid_payload", "The payment payload must carry payload.authorization and payload.signature.");
  }

  const required = paymentRequirements();
  const accepted = payload.accepted;

  // The payer states which offer they are paying. If they echo one back it has to be the
  // offer that was made, or they could sign against terms this service never published.
  if (accepted) {
    if (accepted.scheme !== required.scheme) return failure("invalid_scheme", `This resource is priced with the ${required.scheme} scheme.`);
    if (accepted.network !== required.network) return failure("invalid_network", `This resource settles on ${required.network}.`);
    if (!sameAddress(accepted.asset, required.asset)) return failure("invalid_asset", "The accepted asset is not the asset this resource is priced in.");
    if (!sameAddress(accepted.payTo, required.payTo)) return failure("invalid_pay_to", "The accepted payTo is not this resource's receiving address.");
  }

  // The authorization itself is what settles, so it is checked against the requirements
  // directly rather than being trusted because `accepted` looked right.
  if (!sameAddress(authorization.to, required.payTo)) {
    return failure("invalid_pay_to", "The authorization pays an address other than this resource's receiving address.");
  }

  let value;
  let validAfter;
  let validBefore;
  try {
    value = BigInt(authorization.value);
    validAfter = BigInt(authorization.validAfter);
    validBefore = BigInt(authorization.validBefore);
  } catch {
    return failure("invalid_payload", "value, validAfter and validBefore must be integer strings.");
  }

  // Underpaying is rejected; overpaying is the payer's own choice and settles as signed.
  if (value < BigInt(required.amount)) {
    return failure("insufficient_amount", `This resource costs ${required.amount} minimal units; the authorization signs ${value}.`);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < validAfter) return failure("invalid_time_window", "The authorization is not valid yet.");
  if (now >= validBefore) return failure("authorization_expired", "The authorization has expired; request a fresh challenge.");

  if (!/^0x[0-9a-fA-F]{64}$/.test(String(authorization.nonce || ""))) {
    return failure("invalid_payload", "nonce must be a 32-byte hex string.");
  }

  // The signature check. This is the step that makes EIP-3009 the authorization method
  // rather than a label: it recovers the signer over the exact TransferWithAuthorization
  // struct, bound to the token's own EIP-712 domain, and only `from` can have produced it.
  let signatureValid = false;
  try {
    signatureValid = await verifyTypedData({
      address: getAddress(authorization.from),
      domain: {
        name: required.extra.name,
        version: required.extra.version,
        chainId: chainIdFromNetwork(required.network),
        verifyingContract: getAddress(required.asset),
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value,
        validAfter,
        validBefore,
        nonce: authorization.nonce,
      },
      signature,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return failure("invalid_eoa_signature", "The signature does not recover to the authorization's `from` address.");
  }

  // Claimed only after the signature holds, so an unsigned guess cannot burn a nonce that
  // an honest payer might still want to use.
  if (!claimNonce(authorization.from, authorization.nonce)) {
    return failure("nonce_replayed", "This authorization has already been used. Sign a fresh one.");
  }

  // The facilitator is the only party that can see the payer's balance and the token's
  // on-chain nonce state, so its verdict is final. Failing to reach it fails the request:
  // serving the work on an unverified payment is the one outcome worse than an error.
  const facilitator = getFacilitator();
  if (!facilitator) {
    releaseNonce(authorization.from, authorization.nonce);
    return failure(
      "settlement_unavailable",
      "The payment facilitator is not configured on this service. Set OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE.",
      503,
    );
  }

  try {
    const verdict = await facilitator.verify(payload, required);
    if (!verdict?.isValid) {
      releaseNonce(authorization.from, authorization.nonce);
      return failure(verdict?.invalidReason || "invalid_payment", verdict?.invalidMessage || "The facilitator rejected the payment.");
    }
    return { ok: true, payload, requirements: required, authorization, payer: verdict.payer || authorization.from };
  } catch (error) {
    releaseNonce(authorization.from, authorization.nonce);
    return failure("facilitator_unavailable", `The payment facilitator could not be reached: ${error.message}`, 503);
  }
}

/**
 * Settles a verified authorization on chain. Called only after the work has succeeded, so
 * a payer is never charged for a request that failed to produce a result.
 */
export async function settlePayment(verified) {
  // At a zero price there is nothing to move. The authorization was still required,
  // signed and verified — by us and by the facilitator — so the call was authorized;
  // asking the facilitator to settle a transfer of nothing would either fail or report a
  // transaction that means nothing. Saying so plainly beats inventing a settlement.
  if (BigInt(verified.requirements.amount) === 0n) {
    return { success: true, status: "no_settlement_required", transaction: null, amount: "0", payer: verified.payer };
  }

  const facilitator = getFacilitator();
  if (!facilitator) return { success: false, errorReason: "settlement_unavailable" };

  try {
    const result = await facilitator.settle(verified.payload, verified.requirements);
    // A settlement that comes back failed means the payer was not charged, so their
    // authorization goes back to them rather than staying spent on our side.
    if (result?.success === false) {
      releaseNonce(verified.authorization.from, verified.authorization.nonce);
    }
    return result;
  } catch (error) {
    releaseNonce(verified.authorization.from, verified.authorization.nonce);
    return { success: false, errorReason: "facilitator_unavailable", errorMessage: error.message };
  }
}

/**
 * The PAYMENT-RESPONSE receipt. Built from what the facilitator actually reported — a
 * settlement that is still pending says pending, and nothing here claims a transaction
 * that did not happen.
 */
export function buildPaymentResponse(settleResult, verified) {
  return {
    x402Version: 2,
    scheme: "exact",
    network: config.payment.network,
    asset: config.payment.assetAddress,
    amount: String(settleResult?.amount ?? config.payment.amount),
    amountHuman: humanAmount(settleResult?.amount ?? config.payment.amount, config.payment.assetDecimals),
    decimals: config.payment.assetDecimals,
    payTo: getPayToAddress(),
    payer: settleResult?.payer || verified?.payer || null,
    nonce: verified?.authorization?.nonce || null,
    transaction: settleResult?.transaction || null,
    success: settleResult?.success !== false,
    status: settleResult?.status || (settleResult?.success === false ? "failed" : "success"),
    errorReason: settleResult?.errorReason,
    errorMessage: settleResult?.errorMessage,
  };
}

export function paymentResponseHeaders(settleResult, verified) {
  const encoded = Buffer.from(JSON.stringify(buildPaymentResponse(settleResult, verified)), "utf8").toString("base64");
  return { "PAYMENT-RESPONSE": encoded };
}

export function isFacilitatorConfigured() {
  const { apiKey, secretKey, passphrase } = config.payment;
  return Boolean(apiKey && secretKey && passphrase);
}

let facilitatorClient = null;
function getFacilitator() {
  // An already-built (or injected) client wins, so the credentials check below is only
  // ever about whether one can be built at all.
  if (!facilitatorClient) {
    if (!isFacilitatorConfigured()) return null;
    facilitatorClient = new OKXFacilitatorClient({
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
}

function failure(reason, message, status = 402) {
  return { ok: false, reason, message, status };
}

function chainIdFromNetwork(network) {
  const match = /^eip155:(\d+)$/.exec(String(network));
  if (!match) throw new Error(`Only CAIP-2 eip155 networks are supported, got ${network}`);
  return Number(match[1]);
}

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
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

function getPayToAddress() {
  return config.payment.payToAddress || DEFAULT_ZITOAI_PAY_TO_ADDRESS;
}

function getHeader(request, name) {
  if (typeof request.headers?.get === "function") return request.headers.get(name);
  return request.headers?.[name.toLowerCase()] || request.headers?.[name] || "";
}
