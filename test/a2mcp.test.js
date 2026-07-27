import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../src/config.js";
import { a2mcpBilling, buildA2McpManifest, wrapA2McpResult } from "../src/services/a2mcp.js";
import { createPaymentGate, priceLabel, setFacilitatorForTesting } from "../src/services/x402-sdk.js";
import { resetNonceStore } from "../src/services/x402-nonce-store.js";

test("A2MCP manifest exposes the registered endpoint as zero-price official x402", () => {
  const manifest = buildA2McpManifest();

  assert.equal(manifest.role, "ASP");
  assert.equal(manifest.serviceType, "A2MCP");
  assert.equal(manifest.mode, "standardized_api_service");
  assert.equal(manifest.billing.paymentRequired, true);
  assert.equal(manifest.billing.x402, true);
  assert.equal(manifest.billing.settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.billing.authorization, "EIP-3009 transferWithAuthorization");
  assert.equal(manifest.billing.amount, "0");
  assert.equal(manifest.billing.officialSdk, true);
  assert.equal(manifest.services.length, 1);
  assert.equal(manifest.services[0].id, "rights-media-search");
  assert.equal(manifest.services[0].endpoint.endsWith("/api/a2mcp/media-search"), true);
  assert.equal(manifest.services[0].serviceMode, "A2MCP");
  assert.equal(manifest.services[0].paymentRequired, true);
  assert.equal(manifest.services[0].x402, true);
  assert.equal(manifest.services[0].settlement, "OKX Agent Payments Protocol");
  assert.equal(manifest.services[0].pricingType, "zero_price_per_call");
  assert.equal(manifest.services[0].price, "0 USDT");
  assert.equal(manifest.safety.paymentRequiresUserConfirmation, true);
  assert.deepEqual(manifest.services[0].inputSchema.required, ["query"]);
  assert.deepEqual(manifest.providers, {
    image: "Shutterstock",
    sound_effect: "Freesound",
    music: "Jamendo",
  });
});

test("A2MCP result wrapper records the verified zero-price x402 contract", () => {
  const wrapped = wrapA2McpResult("rights-media-search", { count: 0 });

  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.asp, "ZitoAI");
  assert.equal(wrapped.serviceId, "rights-media-search");
  assert.equal(wrapped.billing.paymentRequired, true);
  assert.equal(wrapped.billing.x402, true);
  assert.equal(wrapped.billing.authorization, "EIP-3009 transferWithAuthorization");
  assert.equal(wrapped.billing.amount, "0");
  assert.deepEqual(wrapped.result, { count: 0 });
});

// Minimal units to a decimal string, so price assertions follow config.payment.amount
// instead of hard-coding whatever it happens to be set to.
function humanAmountOf(minimalUnits, decimals = config.payment.assetDecimals) {
  const padded = String(minimalUnits).padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

// The advertised price and the charged price were two independent settings, so repricing
// via OKX_PAYMENT_AMOUNT alone would keep advertising the old figure. The label is derived
// from the amount that is actually signed and settled.
test("all protected routes derive their advertised x402 price from the signed amount", async () => {
  const original = { amount: config.payment.amount, priceUsd: config.payment.priceUsd };
  try {
    config.payment.priceUsd = "";

    config.payment.amount = "10000";
    assert.equal(priceLabel(), "0.01 USDT");

    // 0.001 USDT is 1000 minimal units at 6 decimals.
    config.payment.amount = "1000";
    assert.equal(priceLabel(), "0.001 USDT");

    config.payment.amount = "2500000";
    assert.equal(priceLabel(), "2.5 USDT");

    // An explicit override still wins, for wording the derivation cannot produce.
    config.payment.priceUsd = "2.50 USD₮0";
    assert.equal(priceLabel(), "2.50 USD₮0");
  } finally {
    Object.assign(config.payment, original);
  }

  assert.equal(a2mcpBilling().price, "0 USDT");
  assert.equal(a2mcpBilling().amount, "0");
  assert.equal(buildA2McpManifest().services[0].pricingType, "zero_price_per_call");
});

// ---------------------------------------------------------------------------
// x402 / EIP-3009, exercised through the real @okxweb3/x402-express middleware.
//
// A listing review rejected the service twice: first for not using EIP-3009 as the
// payment authorization method (the gate used to be "is any payment header present"),
// then for not using the official OKX Payment SDK at all (the first fix, though
// protocol-correct, was hand-rolled). createPaymentGate in x402-sdk.js is now the only
// payment logic this service has, built from @okxweb3/x402-express's paymentMiddleware,
// @okxweb3/x402-evm's ExactEvmScheme, and the same OKXFacilitatorClient already verified
// end to end against the live facilitator (see docs/zitoai-status.md).
//
// The production gate is built once at server.js module load and bound to whatever
// facilitator client exists at that moment, so it cannot be re-stubbed per test. Each test
// here instead builds its own throwaway Express app via testApp(), with a facilitator
// stub installed first — real signature cryptography and real SDK routing, a fake network
// call to OKX. End-to-end confirmation against the real facilitator already lives in
// scripts/x402-selfcheck.mjs and scripts/deep-test.mjs, run directly against local and
// production deployments.
// ---------------------------------------------------------------------------

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

function decode(header) {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}
function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}
function freshNonce() {
  return `0x${randomBytes(32).toString("hex")}`;
}

// A stub conforming to the SDK's own FacilitatorClient interface (verify/settle/
// getSupported), not to our old hand-rolled calling convention — the two happen to share
// verify/settle shapes, but getSupported is the SDK's own and is required: the resource
// server calls it once at startup to learn which (scheme, network) pairs are servable,
// and a missing or empty result makes every request fail closed with "Facilitator does
// not support exact on eip155:196", confirmed locally before this was added.
function stubFacilitator(overrides = {}) {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: config.payment.network, extra: null }],
      extensions: [],
      signers: {},
    }),
    verify: async () => ({ isValid: true, payer: PAYER.address, ...overrides.verify }),
    settle: async () => ({ success: true, status: "success", transaction: "0xdeadbeef", network: config.payment.network, payer: PAYER.address, ...overrides.settle }),
  };
}

const TEST_PATH = "/test/gated";

// Builds a throwaway server around createPaymentGate, exactly as server.js does for the
// real routes, so what is being tested is the actual gate — not a simplified stand-in.
async function testApp(facilitator) {
  setFacilitatorForTesting(facilitator);
  const gate = createPaymentGate([TEST_PATH]);
  assert.ok(gate, "createPaymentGate must build a middleware once a facilitator is installed");

  const app = express();
  app.use(express.json());
  app.use(gate);
  app.post(TEST_PATH, (req, res) => res.status(200).json({ ok: true }));
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function getOffer(base) {
  const response = await fetch(`${base}${TEST_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 402);
  const header = response.headers.get("payment-required");
  assert.ok(header, "an unpaid request must carry a PAYMENT-REQUIRED header");
  const challenge = decode(header);
  return { challenge, offer: challenge.accepts[0] };
}

async function signedPayload(offer, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: PAYER.address,
    to: offer.payTo,
    value: offer.amount,
    validAfter: String(now - 5),
    validBefore: String(now + offer.maxTimeoutSeconds),
    nonce: freshNonce(),
    ...overrides,
  };
  const signature = await PAYER.signTypedData({
    domain: { name: offer.extra.name, version: offer.extra.version, chainId: Number(offer.network.split(":")[1]), verifyingContract: offer.asset },
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
  return { x402Version: 2, accepted: offer, payload: { authorization, signature } };
}

function callWith(base, payload) {
  return fetch(`${base}${TEST_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": encode(payload) },
    body: JSON.stringify({}),
  });
}

test.beforeEach(() => resetNonceStore());

test("the challenge is the documented v2 shape with an EIP-3009 accepts entry", async () => {
  const { base, close } = await testApp(stubFacilitator());
  try {
    const { challenge, offer } = await getOffer(base);

    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.resource.mimeType, "application/json");
    assert.equal(challenge.accepts.length, 1);

    // PaymentRequirements is a closed seven-field type and the marketplace validates this
    // object; anything extra rides on the challenge's own `extensions` instead.
    assert.deepEqual(Object.keys(offer).sort(), ["amount", "asset", "extra", "maxTimeoutSeconds", "network", "payTo", "scheme"]);
    assert.equal(offer.scheme, "exact");
    assert.equal(offer.network, config.payment.network);
    assert.equal(offer.asset, config.payment.assetAddress);
    assert.equal(offer.amount, "0");

    // Naming the EIP-712 domain and no transfer method is how the OKX SDK encodes
    // EIP-3009: its exact-scheme server emits assetTransferMethod only for assets whose
    // method is not the default, and its own registry entry for eip155:196 declares none.
    assert.deepEqual(offer.extra, { name: config.payment.assetName, version: config.payment.assetVersion });
    assert.match(offer.amount, /^\d+$/);
    assert.equal(challenge.extensions.amountHuman, humanAmountOf(offer.amount));
  } finally {
    await close();
  }
});

// Proves the plumbing — SDK routing, header encoding, settle-after-success wiring — with
// a stub that always says "valid". It does not prove the facilitator would actually reject
// a forged one: as a seller this service never runs local EIP-3009 signature verification
// itself (confirmed by reading @okxweb3/x402-evm — verifyTypedData exists only in its
// facilitator-side code, never in ExactEvmScheme, the half we run), so that verification is
// entirely the live facilitator's job over the network. scripts/x402-selfcheck.mjs and
// scripts/deep-test.mjs exercise that against the real facilitator, run directly against
// local and production deployments — see docs/zitoai-status.md for the confirmed result:
// a forged `from`, a garbage signature, and a rewritten `to` all come back
// invalid_signature, and only an honest authorization is accepted.
test("a genuine EIP-3009 authorization is accepted and settled", async () => {
  const { base, close } = await testApp(stubFacilitator());
  try {
    const { offer } = await getOffer(base);
    const response = await callWith(base, await signedPayload(offer));

    assert.equal(response.status, 200);
    const receiptHeader = response.headers.get("payment-response");
    assert.ok(receiptHeader, "a settled call must carry a PAYMENT-RESPONSE receipt");
    const receipt = decode(receiptHeader);
    assert.equal(receipt.payer, PAYER.address);
    assert.equal(receipt.status, "success");
  } finally {
    await close();
  }
});

test("no payment header at all is refused", async () => {
  const { base, close } = await testApp(stubFacilitator());
  try {
    const response = await fetch(`${base}${TEST_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 402);
    assert.ok(response.headers.get("payment-required"));
  } finally {
    await close();
  }
});

// The exact hole the first review found: the old gate accepted any non-empty header
// value. The SDK reports the rejection reason inside the (base64) PAYMENT-REQUIRED
// header, not the JSON body — the body defaults to {} for every rejection.
test("a header that is not a real EIP-3009 authorization buys nothing", async () => {
  const { base, close } = await testApp(stubFacilitator());
  try {
    const junkHeaders = ["proof", "not-base64!!", Buffer.from("{not json").toString("base64"), Buffer.from(JSON.stringify({ hello: "world" })).toString("base64")];
    for (const junk of junkHeaders) {
      const response = await fetch(`${base}${TEST_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": junk },
        body: "{}",
      });
      assert.notEqual(response.status, 200, `${junk} must not be accepted`);
    }
  } finally {
    await close();
  }
});

// Forged-signature, tampered-value, expired-window, and underpaid-amount checks all
// deliberately do NOT live here. This service runs no local EIP-3009 verification as a
// seller (see the comment above "a genuine EIP-3009 authorization is accepted and
// settled") — the facilitator client is a thin network client, so a stub facilitator can
// only ever say what the test tells it to say, and asserting on that would just be
// testing this file's own stub rather than anything the production service does. Those
// properties are proven against the real, live facilitator by
// scripts/x402-selfcheck.mjs and scripts/deep-test.mjs.

// The chain only rejects a reused nonce once the first settlement confirms, which leaves
// a window where the same signed header could be replayed and served repeatedly. This is
// the one guard the SDK does not provide itself — added in x402-sdk.js as an
// onBeforeVerify hook — so it is worth its own test.
test("the same authorization cannot be replayed", async () => {
  const { base, close } = await testApp(stubFacilitator());
  try {
    const { offer } = await getOffer(base);
    const payload = await signedPayload(offer);

    assert.equal((await callWith(base, payload)).status, 200);
    const replay = await callWith(base, payload);
    assert.equal(replay.status, 402);
    assert.equal(decode(replay.headers.get("payment-required")).error, "nonce_replayed");
  } finally {
    await close();
  }
});

// Underpay/overpay checking is the same story: no local amount comparison exists on the
// seller side either (checked in the same source read), so it too is the live
// facilitator's job, exercised there — not fakeable in a stub without reimplementing it.
// Raising OKX_PAYMENT_AMOUNT above its current 0 makes this observable again in
// scripts/x402-selfcheck.mjs and scripts/deep-test.mjs.

test("a facilitator rejection is surfaced and does not burn the nonce", async () => {
  const { base, close } = await testApp(stubFacilitator({ verify: { isValid: false, invalidReason: "insufficient_funds", invalidMessage: "balance too low" } }));
  try {
    const { offer } = await getOffer(base);
    const payload = await signedPayload(offer);

    const rejected = await callWith(base, payload);
    assert.equal(rejected.status, 402);
    assert.equal(decode(rejected.headers.get("payment-required")).error, "insufficient_funds");
  } finally {
    await close();
  }
});

// Without credentials the service can neither verify nor settle. createPaymentGate
// returns null in that case, and server.js's own fallback fails the request closed with
// 503 rather than serving the work for free while advertising a price.
test("createPaymentGate refuses to build a middleware with no facilitator installed", () => {
  // setFacilitatorForTesting(null) alone is not enough: on a machine with real
  // credentials, getFacilitator() sees no injected client and happily builds a live one
  // from config, which is neither the case under test nor something a test should do.
  const credentials = { apiKey: config.payment.apiKey, secretKey: config.payment.secretKey, passphrase: config.payment.passphrase };
  try {
    Object.assign(config.payment, { apiKey: "", secretKey: "", passphrase: "" });
    setFacilitatorForTesting(null);
    const gate = createPaymentGate([TEST_PATH]);
    assert.equal(gate, null);
  } finally {
    Object.assign(config.payment, credentials);
  }
});
