import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";
import { privateKeyToAccount } from "viem/accounts";
import {
  a2mcpBilling,
  buildPaymentResponse,
  buildX402Challenge,
  paymentRequirements,
  priceLabel,
  setFacilitatorForTesting,
  settlePayment,
  verifyPaymentAuthorization,
} from "../src/services/x402-payment.js";
import { resetNonceStore } from "../src/services/x402-nonce-store.js";

test("A2MCP manifest exposes ZitoAI as a per-call x402 ASP service provider", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.mode, "standardized_api_service");
  assert.equal(manifest.billing.paymentRequired, true);
  assert.equal(manifest.billing.x402, true);
  assert.equal(manifest.billing.settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.services.length, 1);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(manifest.services[0].serviceMode, "A2MCP");
  assert.equal(manifest.services[0].paymentRequired, true);
  assert.equal(manifest.services[0].x402, true);
  assert.equal(manifest.services[0].settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.services[0].pricingType, "per_call");
  assert.equal(manifest.services[0].price, "0 USDT");
  assert.equal(manifest.safety.paymentRequiresUserConfirmation, false);
  assert.deepEqual(manifest.services[0].inputSchema.required, ["query"]);
  assert.deepEqual(manifest.providers, {
    image: "Shutterstock",
    sound_effect: "Freesound",
    music: "Jamendo",
  });
});

test("A2MCP result wrapper marks the route as x402 protected", () => {
  const wrapped = wrapA2McpResult("rights-media-search", { count: 0 });

  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.asp, "ZitoAI");
  assert.equal(wrapped.serviceId, "rights-media-search");
  assert.equal(wrapped.billing.paymentRequired, true);
  assert.equal(wrapped.billing.x402, true);
  assert.deepEqual(wrapped.result, { count: 0 });
});

// ---------------------------------------------------------------------------
// x402 / EIP-3009
//
// A listing review rejected the service for not using EIP-3009 as the payment
// authorization method. It never did: the gate was "is any payment header present", so
// `X-PAYMENT: anything` bought a real search. These tests sign genuine EIP-3009
// authorizations and assert that only genuine ones are honoured.
// ---------------------------------------------------------------------------

// Hardhat account #1. A well-known throwaway key, used so the tests can produce real
// signatures without a secret.
const PAYER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

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

function nonceFor(seed) {
  return `0x${String(seed).padStart(64, "0")}`;
}

// Minimal units to a decimal string, so the price assertions follow OKX_PAYMENT_AMOUNT
// instead of hard-coding whatever it happens to be set to.
function humanAmountOf(minimalUnits, decimals = config.payment.assetDecimals) {
  const padded = String(minimalUnits).padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

// Signs against the challenge the service actually publishes, so a test can only pass by
// agreeing with the server on the domain, the struct and the terms.
async function signAuthorization(overrides = {}) {
  const required = paymentRequirements();
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: PAYER.address,
    to: required.payTo,
    value: required.amount,
    validAfter: String(now - 5),
    validBefore: String(now + required.maxTimeoutSeconds),
    nonce: nonceFor(1),
    ...overrides,
  };

  const signature = await PAYER.signTypedData({
    domain: {
      name: required.extra.name,
      version: required.extra.version,
      chainId: Number(required.network.split(":")[1]),
      verifyingContract: required.asset,
    },
    types: AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  return { x402Version: 2, accepted: required, payload: { authorization, signature } };
}

function requestWith(payload) {
  return { headers: { "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") } };
}

// Stands in for the OKX facilitator, which is the only party that can see the payer's
// balance and on-chain nonce state. Everything before that call is ours to get right, and
// is what these tests exercise.
function stubFacilitator(overrides = {}) {
  setFacilitatorForTesting({
    verify: async () => ({ isValid: true, payer: PAYER.address, ...overrides.verify }),
    settle: async () => ({ success: true, status: "success", transaction: "0xdeadbeef", payer: PAYER.address, ...overrides.settle }),
  });
}

test.beforeEach(() => {
  resetNonceStore();
  stubFacilitator();
});

test("the challenge is the documented v2 shape with an EIP-3009 accepts entry", () => {
  const challenge = buildX402Challenge({ resource: `${config.aspBaseUrl}/api/a2mcp/media-search` });

  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.resource.url, "https://asp.zitoai.xyz/api/a2mcp/media-search");
  assert.equal(challenge.resource.mimeType, "application/json");
  assert.equal(challenge.accepts.length, 1);

  // PaymentRequirements is a closed seven-field type and the marketplace validates this
  // object. Extra keys used to ride along here (maxAmountRequired, decimals, amountHuman,
  // outputSchema); they now sit on the challenge's `extensions`, where the type allows
  // them, so the exact key set is asserted rather than just the values.
  const [offer] = challenge.accepts;
  assert.deepEqual(Object.keys(offer).sort(), ["amount", "asset", "extra", "maxTimeoutSeconds", "network", "payTo", "scheme"]);
  assert.equal(offer.scheme, "exact");
  assert.equal(offer.network, "eip155:196");
  assert.equal(offer.asset, "0x779ded0c9e1022225f8e0630b35a9b54be713736");

  // Naming the EIP-712 domain and no transfer method is how the OKX SDK encodes EIP-3009:
  // its exact-scheme server emits assetTransferMethod only for assets whose method is not
  // the default, and its own registry entry for eip155:196 declares none.
  assert.deepEqual(offer.extra, { name: "USD₮0", version: "1" });

  // The price is free, and the authorization is real anyway: verified against the live
  // OKX facilitator, amount 0 still fails a forged signature with invalid_signature.
  assert.match(offer.amount, /^\d+$/);
  assert.equal(challenge.extensions.amountHuman, humanAmountOf(offer.amount));
});

// The advertised price and the charged price were two independent settings, so repricing
// via OKX_PAYMENT_AMOUNT alone would keep advertising the old figure. The label is now
// derived from the amount that is actually signed and settled.
test("the advertised price follows the amount actually charged", async () => {
  const original = { amount: config.payment.amount, priceUsd: config.payment.priceUsd };
  try {
    config.payment.priceUsd = "";

    config.payment.amount = "10000";
    assert.equal(priceLabel(), "0.01 USDT");
    assert.equal(a2mcpBilling().price, "0.01 USDT");

    // 0.001 USDT is 1000 minimal units at 6 decimals.
    config.payment.amount = "1000";
    assert.equal(priceLabel(), "0.001 USDT");
    assert.equal(buildA2McpManifest().services[0].price, "0.001 USDT");

    config.payment.amount = "2500000";
    assert.equal(priceLabel(), "2.5 USDT");

    // An explicit override still wins, for wording the derivation cannot produce.
    config.payment.priceUsd = "2.50 USD₮0";
    assert.equal(priceLabel(), "2.50 USD₮0");
  } finally {
    Object.assign(config.payment, original);
  }
});

test("a genuine EIP-3009 authorization is accepted", async () => {
  const result = await verifyPaymentAuthorization(requestWith(await signAuthorization()));

  assert.equal(result.ok, true, result.message);
  assert.equal(result.payer, PAYER.address);
});

test("a request with no payment header is not served", async () => {
  const result = await verifyPaymentAuthorization({ headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "payment_required");
  assert.equal(result.status, 402);
});

// The exact hole the review found: the old gate accepted any non-empty header value.
test("a header that is not an EIP-3009 authorization buys nothing", async () => {
  const junkHeaders = [
    "proof",
    "not-base64!!",
    Buffer.from("{not json").toString("base64"),
    Buffer.from(JSON.stringify({ hello: "world" })).toString("base64"),
  ];

  for (const junk of junkHeaders) {
    const result = await verifyPaymentAuthorization({ headers: { "x-payment": junk } });
    assert.equal(result.ok, false, `${junk} must not be accepted`);
    assert.ok(["payment_required", "invalid_payload"].includes(result.reason), `unexpected reason ${result.reason}`);
  }
});

test("a signature from someone other than the claimed payer is rejected", async () => {
  const payload = await signAuthorization();
  // Claim a different payer while keeping the original signature.
  payload.payload.authorization.from = "0x000000000000000000000000000000000000dEaD";

  const result = await verifyPaymentAuthorization(requestWith(payload));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_eoa_signature");
});

test("tampering with the signed terms invalidates the signature", async () => {
  // Raising the value after signing: the struct no longer hashes to what was signed.
  const payload = await signAuthorization();
  payload.payload.authorization.value = "99999999";

  const result = await verifyPaymentAuthorization(requestWith(payload));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_eoa_signature");
});

test("an authorization paying somebody else is rejected", async () => {
  const payload = await signAuthorization({ to: "0x000000000000000000000000000000000000dEaD" });

  const result = await verifyPaymentAuthorization(requestWith(payload));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_pay_to");
});

// Priced at 0 nothing can underpay, so the check is exercised against a non-zero price:
// it is what protects the service the moment OKX_PAYMENT_AMOUNT is raised.
test("underpaying is rejected and overpaying is allowed", async () => {
  const original = config.payment.amount;
  try {
    config.payment.amount = "10000";

    const under = await verifyPaymentAuthorization(requestWith(await signAuthorization({ value: "1", nonce: nonceFor(2) })));
    assert.equal(under.ok, false);
    assert.equal(under.reason, "insufficient_amount");

    // Overpaying is the payer's own choice, and settles as signed.
    const over = await verifyPaymentAuthorization(requestWith(await signAuthorization({ value: "99999999", nonce: nonceFor(3) })));
    assert.equal(over.ok, true, over.message);
  } finally {
    config.payment.amount = original;
  }
});

// Free is a price, not an exemption: the authorization is still required and still has to
// be genuine. Confirmed against the live OKX facilitator, which returns invalid_signature
// for a forged authorization at amount 0 and validates an honest one.
test("a free call still requires a real EIP-3009 authorization", async () => {
  assert.equal(config.payment.amount, "0", "this test is about the free configuration");

  const unsigned = await verifyPaymentAuthorization({ headers: { "payment-signature": "proof" } });
  assert.equal(unsigned.ok, false);

  const forged = await signAuthorization({ nonce: nonceFor(4) });
  forged.payload.authorization.from = "0x000000000000000000000000000000000000dEaD";
  assert.equal((await verifyPaymentAuthorization(requestWith(forged))).reason, "invalid_eoa_signature");

  const honest = await verifyPaymentAuthorization(requestWith(await signAuthorization({ nonce: nonceFor(5) })));
  assert.equal(honest.ok, true, honest.message);
});

// Nothing moves at a zero price, and reporting a settlement that did not happen would be
// worse than reporting none.
test("a free call settles as no_settlement_required rather than inventing a transfer", async () => {
  const verified = await verifyPaymentAuthorization(requestWith(await signAuthorization({ nonce: nonceFor(6) })));
  assert.equal(verified.ok, true, verified.message);

  // The facilitator is not asked to settle at all: a stub that would fail the call proves
  // settlement is skipped rather than merely tolerated.
  setFacilitatorForTesting({
    verify: async () => ({ isValid: true, payer: PAYER.address }),
    settle: async () => { throw new Error("settle must not be called at a zero price"); },
  });

  const settlement = await settlePayment(verified);
  assert.equal(settlement.success, true);
  assert.equal(settlement.status, "no_settlement_required");
  assert.equal(settlement.transaction, null);

  const receipt = buildPaymentResponse(settlement, verified);
  assert.equal(receipt.status, "no_settlement_required");
  assert.equal(receipt.transaction, null);
  assert.equal(receipt.payer, PAYER.address);
});

test("an expired authorization is rejected", async () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const payload = await signAuthorization({ validAfter: String(past - 60), validBefore: String(past) });

  const result = await verifyPaymentAuthorization(requestWith(payload));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "authorization_expired");
});

test("an authorization signed for a different offer is rejected", async () => {
  const payload = await signAuthorization();
  payload.accepted = { ...payload.accepted, network: "eip155:1" };

  const result = await verifyPaymentAuthorization(requestWith(payload));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_network");
});

// The chain rejects a reused nonce only once the first settlement confirms, which leaves
// a window where the same header could be replayed and served repeatedly.
test("the same authorization cannot be replayed", async () => {
  const payload = await signAuthorization();

  assert.equal((await verifyPaymentAuthorization(requestWith(payload))).ok, true);

  const replay = await verifyPaymentAuthorization(requestWith(payload));
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "nonce_replayed");
});

test("a facilitator rejection is surfaced and does not burn the nonce", async () => {
  stubFacilitator({ verify: { isValid: false, invalidReason: "insufficient_funds", invalidMessage: "balance too low" } });
  const payload = await signAuthorization();

  const rejected = await verifyPaymentAuthorization(requestWith(payload));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "insufficient_funds");

  // The payer was never charged, so the authorization is still theirs to spend once they
  // top up. Holding the claim would burn a nonce they got nothing for.
  stubFacilitator();
  assert.equal((await verifyPaymentAuthorization(requestWith(payload))).ok, true);
});

// Without credentials the service can neither verify nor settle. Serving the work anyway
// would be giving it away while advertising a price.
test("an unconfigured facilitator fails the request instead of serving for free", async () => {
  // The credentials are blanked rather than just dropping the injected client: on a
  // machine that has real ones, clearing the client alone lets the code build a live
  // facilitator and call OKX for real, which is neither the case under test nor
  // something a test should do.
  const credentials = { apiKey: config.payment.apiKey, secretKey: config.payment.secretKey, passphrase: config.payment.passphrase };
  try {
    Object.assign(config.payment, { apiKey: "", secretKey: "", passphrase: "" });
    setFacilitatorForTesting(null);

    const result = await verifyPaymentAuthorization(requestWith(await signAuthorization()));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "settlement_unavailable");
    assert.equal(result.status, 503);
  } finally {
    Object.assign(config.payment, credentials);
  }
});

test("the receipt reports what the facilitator actually did", async () => {
  const verified = await verifyPaymentAuthorization(requestWith(await signAuthorization()));
  const receipt = buildPaymentResponse({ success: true, status: "success", transaction: "0xdeadbeef", payer: PAYER.address }, verified);

  assert.equal(receipt.x402Version, 2);
  assert.equal(receipt.scheme, "exact");
  assert.equal(receipt.success, true);
  assert.equal(receipt.transaction, "0xdeadbeef");
  assert.equal(receipt.payer, PAYER.address);
  assert.equal(receipt.amountHuman, humanAmountOf(config.payment.amount));

  // A failed settlement must not read as a success, and must not invent a transaction.
  const failed = buildPaymentResponse({ success: false, errorReason: "insufficient_funds" }, verified);
  assert.equal(failed.success, false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.transaction, null);
  assert.equal(failed.errorReason, "insufficient_funds");
});
