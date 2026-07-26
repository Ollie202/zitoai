// Endpoint self-check from the A2MCP guide: an unpaid call must answer 402 with a
// PAYMENT-REQUIRED header, and a call that is not a genuine EIP-3009 authorization must
// not be served. Run it against a local server or the deployed endpoint before
// resubmitting a listing.
//
//   node scripts/x402-selfcheck.mjs [base-url]
import { privateKeyToAccount } from "viem/accounts";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const endpoint = `${base}/api/a2mcp/media-search`;

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

const decode = (header) => JSON.parse(Buffer.from(header, "base64").toString("utf8"));
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

let failures = 0;
function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}

// 1. Unpaid call
const unpaid = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "rain on a window" }),
});
check("unpaid call answers 402", unpaid.status === 402, `got ${unpaid.status}`);

const header = unpaid.headers.get("payment-required");
check("PAYMENT-REQUIRED header present", Boolean(header));
if (!header) process.exit(1);

const challenge = decode(header);
const [offer] = challenge.accepts || [];
check("x402Version is 2", challenge.x402Version === 2, String(challenge.x402Version));
check("scheme is exact", offer?.scheme === "exact", offer?.scheme);
check("EIP-712 domain present for EIP-3009", Boolean(offer?.extra?.name && offer?.extra?.version), JSON.stringify(offer?.extra));
check(
  "accepts entry carries only the documented fields",
  JSON.stringify(Object.keys(offer || {}).sort()) ===
    JSON.stringify(["amount", "asset", "extra", "maxTimeoutSeconds", "network", "payTo", "scheme"]),
  Object.keys(offer || {}).sort().join(","),
);
check("amount is an integer string", /^\d+$/.test(String(offer?.amount)), `${offer?.amount} minimal units`);

// 2. A header that is not a real authorization must buy nothing.
const junk = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": "proof" },
  body: JSON.stringify({ query: "rain on a window" }),
});
check("an unsigned payment header is refused", junk.status !== 200, `got ${junk.status}`);

// 3. A forged authorization — correctly signed, but by someone who is not `from`.
const payer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payer.address,
  to: offer.payTo,
  value: offer.amount,
  validAfter: String(now - 5),
  validBefore: String(now + offer.maxTimeoutSeconds),
  nonce: `0x${"11".repeat(32)}`,
};
const signature = await payer.signTypedData({
  domain: {
    name: offer.extra.name,
    version: offer.extra.version,
    chainId: Number(offer.network.split(":")[1]),
    verifyingContract: offer.asset,
  },
  types: AUTHORIZATION_TYPES,
  primaryType: "TransferWithAuthorization",
  message: {
    ...authorization,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
  },
});

const forged = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "PAYMENT-SIGNATURE": encode({
      x402Version: 2,
      accepted: offer,
      // Someone else's address against a signature that is not theirs.
      payload: { authorization: { ...authorization, from: "0x000000000000000000000000000000000000dEaD" }, signature },
    }),
  },
  body: JSON.stringify({ query: "rain on a window" }),
});
const forgedBody = await forged.json().catch(() => ({}));
check("a forged signature is refused", forged.status !== 200, `got ${forged.status} ${forgedBody.error || ""}`);

// 4. A genuine authorization. Always reaches the facilitator's /verify — including at a
//    zero price, where it still checks the signature and rejects forgeries.
const genuine = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "PAYMENT-SIGNATURE": encode({ x402Version: 2, accepted: offer, payload: { authorization, signature } }),
  },
  body: JSON.stringify({ query: "rain on a window" }),
});
const genuineBody = await genuine.json().catch(() => ({}));
check("a genuine EIP-3009 authorization is served", genuine.status === 200, `got ${genuine.status} ${genuineBody.error || ""}`);

const receiptHeader = genuine.headers.get("payment-response");
if (receiptHeader) {
  const receipt = decode(receiptHeader);
  console.log(`\nPAYMENT-RESPONSE: status=${receipt.status} payer=${receipt.payer} tx=${receipt.transaction ?? "none"}`);
} else if (genuineBody.error === "settlement_unavailable") {
  console.log("\n  OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE are not set on this deployment.");
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
