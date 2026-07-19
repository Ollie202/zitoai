import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { publicProviderInfo } from "./providers/index.js";
import { buildA2McpManifest, wrapA2McpResult } from "./services/a2mcp.js";
import { paymentStatus } from "./services/x402-payment.js";
import { brainStatus, normalizeBrief } from "./services/openrouter.js";
import { searchAssets } from "./services/search-service.js";
import { buildEvidenceManifest, buildEvidencePdf, evidenceHash } from "./services/evidence-pack.js";
import { completeOAuth, oauthStatus, startOAuth } from "./services/oauth.js";
import { downloadFreesoundOriginal, freesoundStatus, getFreesoundMe } from "./services/freesound.js";
import { jamendoStatus } from "./services/jamendo.js";
import {
  getShutterstockImageDetails,
  licenseShutterstockImage,
  listShutterstockImageLicenses,
  listShutterstockImageCategories,
  listShutterstockSubscriptions,
  redownloadShutterstockImage,
  shutterstockStatus,
} from "./services/shutterstock.js";
import {
  createEvidenceUpload,
  createProcurement,
  getProcurement,
  listProcurements,
  listProviderConnections,
  recordPurchase,
  registerEvidence,
  storageStatus,
} from "./services/supabase.js";

const root = fileURLToPath(new URL("../public", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const agentCard = {
  name: "ZitoAI",
  description: "Finds licensable media, screens provider-specific usage rules, and produces verifiable License Evidence Packs.",
  version: "0.1.0",
  url: config.aspBaseUrl,
  websiteUrl: config.publicBaseUrl,
  role: "ASP",
  protocol: "A2MCP",
  capabilities: { streaming: false, pushNotifications: false, a2mcp: true },
  services: [
    { id: "rights-media-search", name: "Rights-aware media search", endpoint: `${config.aspBaseUrl}/api/a2mcp/media-search`, price: "free", paymentRequired: false, x402: false },
  ],
  safety: { paymentRequiresUserConfirmation: false, legalAdvice: false },
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        service: "zitoai",
        version: "0.1.0",
        brain: brainStatus(),
        storage: storageStatus(),
        oauth: oauthStatus(),
        payment: paymentStatus(),
      });
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return json(response, 200, {
        supabase: {
          configured: storageStatus().configured,
          url: config.supabase.url || null,
          anonKey: config.supabase.anonKey || null,
        },
        oauth: { callbackBaseUrl: config.oauth?.callbackBaseUrl || config.openRouter.siteUrl },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/providers") {
      return json(response, 200, { providers: publicProviderInfo() });
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/status") {
      return json(response, 200, shutterstockStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/freesound/status") {
      return json(response, 200, freesoundStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/jamendo/status") {
      return json(response, 200, jamendoStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/categories") {
      return json(response, 200, await listShutterstockImageCategories());
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/subscriptions") {
      return json(response, 200, await listShutterstockSubscriptions());
    }
    const shutterstockImageMatch = url.pathname.match(/^\/api\/providers\/shutterstock\/images\/([^/]+)$/i);
    if (request.method === "GET" && shutterstockImageMatch) {
      return json(response, 200, await getShutterstockImageDetails(shutterstockImageMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/api/providers/shutterstock/licenses") {
      return json(response, 200, await listShutterstockImageLicenses(Object.fromEntries(url.searchParams)));
    }
    if (request.method === "POST" && url.pathname === "/api/providers/shutterstock/license") {
      return json(response, 201, { license: await licenseShutterstockImage(await readJson(request)) });
    }
    const freesoundDownloadMatch = url.pathname.match(/^\/api\/providers\/freesound\/sounds\/([0-9]+)\/download$/i);
    if (request.method === "POST" && freesoundDownloadMatch) {
      return json(response, 201, { download: await downloadFreesoundOriginal(request, freesoundDownloadMatch[1]) });
    }
    if (request.method === "GET" && url.pathname === "/api/providers/freesound/me") {
      return json(response, 200, await getFreesoundMe(request));
    }
    const shutterstockRedownloadMatch = url.pathname.match(/^\/api\/providers\/shutterstock\/licenses\/([^/]+)\/download$/i);
    if (request.method === "POST" && shutterstockRedownloadMatch) {
      return json(response, 201, { download: await redownloadShutterstockImage({ ...(await readJson(request)), licenseId: shutterstockRedownloadMatch[1] }) });
    }
    if (request.method === "GET" && ["/api/agent", "/.well-known/agent.json", "/.well-known/agent-card.json"].includes(url.pathname)) {
      return json(response, 200, agentCard);
    }
    if (request.method === "GET" && ["/api/a2mcp", "/api/a2mcp/manifest", "/.well-known/a2mcp.json"].includes(url.pathname)) {
      return json(response, 200, buildA2McpManifest());
    }
    if (request.method === "GET" && url.pathname === "/api/oauth/connections") {
      return json(response, 200, { connections: await listProviderConnections(request) });
    }
    if (request.method === "POST" && url.pathname === "/api/brief") {
      return json(response, 200, await normalizeBrief(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/search") {
      return json(response, 200, await searchAssets(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/agent/search") {
      return json(response, 200, { ...(await searchAssets(await readJson(request))), agent: "ZitoAI", role: "ASP", protocol: "A2MCP", paymentRequired: false });
    }
    if (request.method === "POST" && url.pathname === "/api/a2mcp/media-search") {
      const body = wrapA2McpResult("rights-media-search", await searchAssets(await readJson(request)));
      return json(response, 200, body);
    }
    if (request.method === "POST" && url.pathname === "/api/a2mcp/evidence-manifest") {
      return json(response, 200, wrapA2McpResult("license-evidence-manifest", buildEvidenceManifest(await readJson(request))));
    }
    if (request.method === "POST" && url.pathname === "/api/evidence-pack") {
      const manifest = buildEvidenceManifest(await readJson(request));
      if (url.searchParams.get("format") === "pdf") {
        const pdf = await buildEvidencePdf(manifest);
        return binary(response, 200, pdf, "application/pdf", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.pdf`, evidenceHash(pdf));
      }
      const body = Buffer.from(JSON.stringify(manifest, null, 2));
      return binary(response, 200, body, "application/json; charset=utf-8", `zito-evidence-${manifest.asset.provider || "asset"}-${manifest.asset.id || "record"}.json`, manifest.manifestSha256);
    }
    const oauthStartMatch = url.pathname.match(/^\/api\/oauth\/([a-z0-9_-]+)\/start$/i);
    if (request.method === "POST" && oauthStartMatch) {
      return json(response, 200, await startOAuth(request, oauthStartMatch[1]));
    }
    const oauthCallbackMatch = url.pathname.match(/^\/auth\/([a-z0-9_-]+)\/callback$/i);
    if (request.method === "GET" && oauthCallbackMatch) {
      try {
        const result = await completeOAuth(oauthCallbackMatch[1], Object.fromEntries(url.searchParams));
        return redirect(response, `/oauth-callback.html?provider=${encodeURIComponent(result.provider)}`);
      } catch (error) {
        return redirect(response, `/oauth-callback.html?error=${encodeURIComponent(error.message)}`);
      }
    }
    if (request.method === "GET" && url.pathname === "/api/procurements") {
      return json(response, 200, { procurements: await listProcurements(request) });
    }
    if (request.method === "POST" && url.pathname === "/api/procurements") {
      return json(response, 201, { procurement: await createProcurement(request, await readJson(request)) });
    }
    const procurementMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && procurementMatch) {
      return json(response, 200, { procurement: await getProcurement(request, procurementMatch[1]) });
    }
    const purchaseMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/purchase$/i);
    if (request.method === "POST" && purchaseMatch) {
      return json(response, 201, { result: await recordPurchase(request, purchaseMatch[1], await readJson(request)) });
    }
    const uploadMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/evidence\/upload$/i);
    if (request.method === "POST" && uploadMatch) {
      return json(response, 201, { upload: await createEvidenceUpload(request, uploadMatch[1], await readJson(request)) });
    }
    const evidenceMatch = url.pathname.match(/^\/api\/procurements\/([0-9a-f-]+)\/evidence$/i);
    if (request.method === "POST" && evidenceMatch) {
      return json(response, 201, { evidence: await registerEvidence(request, evidenceMatch[1], await readJson(request)) });
    }
    if (request.method === "GET") return serveStatic(url.pathname, response);

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error.message === "Request body is too large" ? 413 : 400;
    return json(response, status, { error: error.message || "Unexpected error" });
  }
});

server.listen(config.port, () => {
  console.log(`ZitoAI running at http://localhost:${config.port}`);
  console.log(`OpenRouter: ${brainStatus().configured ? "configured" : "local fallback"}`);
});

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  }));
  response.end(JSON.stringify(body));
}

function instruction(response, instruction) {
  const headers = instruction.headers || {};
  const contentType = headers["Content-Type"] || headers["content-type"] || "application/json; charset=utf-8";
  response.writeHead(instruction.status || 402, securityHeaders({ ...headers, "Content-Type": contentType, "Cache-Control": "no-store" }));
  if (instruction.isHtml) return response.end(String(instruction.body || ""));
  response.end(JSON.stringify(instruction.body || {}));
}

function binary(response, status, body, contentType, fileName, hash) {
  response.writeHead(status, securityHeaders({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Evidence-SHA256": hash,
    "Access-Control-Expose-Headers": "X-Evidence-SHA256",
  }));
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(302, securityHeaders({ Location: location, "Cache-Control": "no-store" }));
  response.end();
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 100_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return json(response, 400, { error: "Invalid path" });
  }
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^[/\\]+/, "");
  const path = resolve(root, requested);
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return json(response, 403, { error: "Forbidden" });
  try {
    const content = await readFile(path);
    response.writeHead(200, securityHeaders({
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    }));
    response.end(content);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

function securityHeaders(headers) {
  return {
    ...headers,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  };
}
