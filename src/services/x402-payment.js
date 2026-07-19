import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { SETTLEMENT_OVERRIDES_HEADER, x402HTTPResourceServer, x402ResourceServer } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "../config.js";

const PROTECTED_ROUTES = {
  "POST /api/a2mcp/media-search": {
    accepts: [
      {
        scheme: "exact",
        network: config.payment.network,
        payTo: () => config.payment.payToAddress,
        price: () => config.payment.priceUsd,
      },
    ],
    description: "ZitoAI rights-aware media search and licensing-route recommendation",
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json; charset=utf-8",
      body: {
        ok: false,
        agent: "ZitoAI",
        role: "ASP",
        protocol: "A2MCP",
        paymentRequired: true,
        x402: true,
        price: config.payment.priceUsd,
        network: config.payment.network,
        message: "Payment required to call ZitoAI media-search.",
      },
    }),
  },
};

let httpServerPromise;

export function paymentStatus() {
  return {
    enabled: Boolean(config.payment.enabled),
    configured: Boolean(config.payment.apiKey && config.payment.secretKey && config.payment.passphrase && config.payment.payToAddress),
    mode: config.payment.enabled ? "x402_pay_per_call" : "free",
    price: config.payment.priceUsd,
    network: config.payment.network,
    payToConfigured: Boolean(config.payment.payToAddress),
    facilitatorBaseUrl: config.payment.baseUrl,
    protectedRoutes: Object.keys(PROTECTED_ROUTES),
  };
}

export function a2mcpBilling() {
  const status = paymentStatus();
  if (!status.enabled) {
    return {
      type: "free",
      paymentRequired: false,
      x402: false,
      settlement: "instant_per_call_free",
      price: "0",
      pricingType: "free",
      note: "Free mode is active. Set OKX_PAYMENT_ENABLED=true with OKX facilitator credentials and PAY_TO_ADDRESS to require x402 per call.",
    };
  }
  return {
    type: "paid",
    paymentRequired: true,
    x402: true,
    settlement: "instant_per_call_x402",
    price: config.payment.priceUsd,
    pricingType: "pay_per_call",
    network: config.payment.network,
    payToConfigured: status.payToConfigured,
    note: "Paid mode is active. Calls to the protected A2MCP endpoint must first satisfy an OKX x402 payment challenge.",
  };
}

export async function processX402Request(request, url) {
  if (!config.payment.enabled) return { type: "no-payment-required" };
  if (!paymentStatus().configured) {
    return {
      type: "payment-error",
      response: {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: {
          ok: false,
          error: "x402 payment is enabled but OKX payment credentials or PAY_TO_ADDRESS are missing.",
          requiredVariables: ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "PAY_TO_ADDRESS"],
        },
      },
    };
  }

  const httpServer = await getHttpServer();
  const adapter = new NodeHttpAdapter(request, url);
  return httpServer.processHTTPRequest({
    adapter,
    path: url.pathname,
    method: request.method,
    paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
  });
}

export async function settleX402Payment(paymentResult, request, url, body, headers = {}) {
  if (paymentResult?.type !== "payment-verified") return { success: true, headers: {} };
  const httpServer = await getHttpServer();
  const responseBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""));
  const responseHeaders = {};
  if (headers[SETTLEMENT_OVERRIDES_HEADER]) {
    responseHeaders[SETTLEMENT_OVERRIDES_HEADER] = String(headers[SETTLEMENT_OVERRIDES_HEADER]);
  }
  return httpServer.processSettlement(
    paymentResult.paymentPayload,
    paymentResult.paymentRequirements,
    paymentResult.declaredExtensions,
    {
      request: {
        adapter: new NodeHttpAdapter(request, url),
        path: url.pathname,
        method: request.method,
        paymentHeader: request.headers["payment-signature"] || request.headers["x-payment"],
      },
      responseBody,
      responseHeaders,
    },
  );
}

async function getHttpServer() {
  if (!httpServerPromise) httpServerPromise = initializeHttpServer();
  return httpServerPromise;
}

async function initializeHttpServer() {
  const facilitatorClient = new OKXFacilitatorClient({
    apiKey: config.payment.apiKey,
    secretKey: config.payment.secretKey,
    passphrase: config.payment.passphrase,
    baseUrl: config.payment.baseUrl,
    syncSettle: config.payment.syncSettle,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(config.payment.network, new ExactEvmScheme());
  const httpServer = new x402HTTPResourceServer(resourceServer, PROTECTED_ROUTES);
  await httpServer.initialize();
  return httpServer;
}

class NodeHttpAdapter {
  constructor(request, url) {
    this.request = request;
    this.url = url;
  }

  getHeader(name) {
    return this.request.headers[String(name).toLowerCase()];
  }

  getMethod() {
    return this.request.method || "GET";
  }

  getPath() {
    return this.url.pathname;
  }

  getUrl() {
    return `${config.aspBaseUrl.replace(/\/+$/, "")}${this.url.pathname}${this.url.search}`;
  }

  getAcceptHeader() {
    return this.getHeader("accept") || "";
  }

  getUserAgent() {
    return this.getHeader("user-agent") || "";
  }

  getQueryParams() {
    const params = {};
    for (const [key, value] of this.url.searchParams.entries()) {
      if (params[key] == null) params[key] = value;
      else if (Array.isArray(params[key])) params[key].push(value);
      else params[key] = [params[key], value];
    }
    return params;
  }

  getQueryParam(name) {
    const values = this.url.searchParams.getAll(name);
    if (values.length === 0) return undefined;
    return values.length === 1 ? values[0] : values;
  }
}
