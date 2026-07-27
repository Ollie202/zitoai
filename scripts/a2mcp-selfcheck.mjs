import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const base = String(process.argv[2] || process.env.ASP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const endpoint = `${base}/api/a2mcp/media-search`;
const timeoutMs = Number(process.env.A2MCP_SMOKE_TIMEOUT_MS || 60_000);
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const body = {
  query: "Warm cinematic music for a hopeful travel film",
  assetType: "music",
  intendedUse: "commercial_content",
  limit: 3,
};

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const decode = (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8"));
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

async function request(headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": `smoke-${Date.now()}-${randomBytes(4).toString("hex")}`,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const startedAt = Date.now();
try {
  const unpaid = await request();
  if (unpaid.status !== 402) throw new Error(`unpaid request expected HTTP 402, received ${unpaid.status}`);

  const challengeHeader = unpaid.headers.get("payment-required");
  if (!challengeHeader) throw new Error("unpaid response is missing PAYMENT-REQUIRED");
  const challenge = decode(challengeHeader);
  const accepted = challenge?.accepts?.[0];
  if (challenge.x402Version !== 2) throw new Error(`expected x402Version 2, received ${challenge.x402Version}`);
  if (!accepted) throw new Error("challenge has no accepts entry");
  if (accepted.scheme !== "exact") throw new Error(`expected exact scheme, received ${accepted.scheme}`);
  if (accepted.network !== "eip155:196") throw new Error(`expected X Layer mainnet, received ${accepted.network}`);
  if (accepted.asset.toLowerCase() !== "0x779ded0c9e1022225f8e0630b35a9b54be713736") throw new Error("challenge asset is not X Layer USD₮0");
  if (accepted.amount !== "0") throw new Error(`expected atomic amount 0, received ${accepted.amount}`);
  if (accepted.extra?.name !== "USD₮0" || accepted.extra?.version !== "1" || accepted.extra?.assetTransferMethod) {
    throw new Error("accepts entry does not select the documented EIP-3009 token domain");
  }
  if (challenge.extensions?.decimals !== 6 || challenge.extensions?.amountHuman !== "0") {
    throw new Error("challenge is missing zero-price display metadata");
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: String(now - 5),
    validBefore: String(now + accepted.maxTimeoutSeconds),
    nonce: `0x${randomBytes(32).toString("hex")}`,
  };
  const signature = await account.signTypedData({
    domain: {
      name: accepted.extra.name,
      version: accepted.extra.version,
      chainId: Number(accepted.network.split(":")[1]),
      verifyingContract: accepted.asset,
    },
    types: authorizationTypes,
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
  const paymentPayload = {
    x402Version: 2,
    accepted,
    payload: { authorization, signature },
  };

  const paid = await request({ "PAYMENT-SIGNATURE": encode(paymentPayload) });
  const responseBody = await paid.json().catch(() => null);
  if (paid.status !== 200) throw new Error(`signed replay expected HTTP 200, received ${paid.status}: ${JSON.stringify(responseBody)}`);

  const receiptHeader = paid.headers.get("payment-response");
  if (!receiptHeader) throw new Error("signed replay is missing PAYMENT-RESPONSE");
  const receipt = decode(receiptHeader);
  if (receipt.status !== "success" || receipt.network !== accepted.network) {
    throw new Error(`unexpected settlement receipt: ${JSON.stringify(receipt)}`);
  }
  if (!responseBody?.ok || responseBody?.serviceId !== "rights-media-search") {
    throw new Error("signed replay did not return the A2MCP result envelope");
  }
  if (!Array.isArray(responseBody?.result?.results)) {
    throw new Error("signed replay is missing the media result array");
  }
  if (responseBody.billing?.authorization !== "EIP-3009 transferWithAuthorization") {
    throw new Error("result envelope does not identify EIP-3009 authorization");
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    durationMs: Date.now() - startedAt,
    challenge: {
      x402Version: challenge.x402Version,
      scheme: accepted.scheme,
      network: accepted.network,
      asset: accepted.asset,
      amount: accepted.amount,
      amountHuman: challenge.extensions.amountHuman,
      decimals: challenge.extensions.decimals,
      authorization: "EIP-3009 transferWithAuthorization",
    },
    replay: {
      status: paid.status,
      receiptStatus: receipt.status,
      transaction: receipt.transaction || null,
      requestId: paid.headers.get("x-request-id"),
      resultCount: responseBody.result.count,
      recommendedProvider: responseBody.result.recommendedProvider,
    },
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    endpoint,
    durationMs: Date.now() - startedAt,
    error: error?.name === "AbortError" ? `request exceeded ${timeoutMs}ms` : error?.message,
  }, null, 2));
  process.exitCode = 1;
}
