import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { publicProviderInfo } from "./providers/index.js";
import { brainStatus, normalizeBrief } from "./services/openrouter.js";
import { searchAssets } from "./services/search-service.js";
import {
  createEvidenceUpload,
  createProcurement,
  getProcurement,
  listProcurements,
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
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        service: "license-hunter",
        version: "0.1.0",
        brain: brainStatus(),
        storage: storageStatus(),
      });
    }
    if (request.method === "GET" && url.pathname === "/api/providers") {
      return json(response, 200, { providers: publicProviderInfo() });
    }
    if (request.method === "POST" && url.pathname === "/api/brief") {
      return json(response, 200, await normalizeBrief(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/search") {
      return json(response, 200, await searchAssets(await readJson(request)));
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
  console.log(`License Hunter running at http://localhost:${config.port}`);
  console.log(`OpenRouter: ${brainStatus().configured ? "configured" : "local fallback"}`);
});

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
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
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const path = join(root, safe);
  if (!path.startsWith(root)) return json(response, 403, { error: "Forbidden" });
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}
