import { Readable } from "node:stream";
import { config } from "../config.js";

// Jamendo's download endpoint serves a valid MP3 but labels it
// `Content-Type: text/html; charset=UTF-8`. Their preview endpoint gets it right;
// the download one does not. Any client that trusts the header — a browser, or an
// agent deciding how to handle the response — renders binary audio as a web page.
//
// This route re-serves the same bytes with the correct type. It is not a general
// proxy: the only caller-supplied value is a numeric track id, and the upstream URL
// is built here, so no arbitrary host can be fetched through it.
const JAMENDO_STORAGE_HOST = "https://prod-1.storage.jamendo.com";
const AUDIO_CONTENT_TYPE = "audio/mpeg";
const DOWNLOAD_TIMEOUT_MS = 30_000;

// Guards against a hung or malicious upstream streaming indefinitely through us.
// Comfortably above a long music track at mp32 (~320kbps ≈ 2.4 MB/min).
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

export function jamendoTrackId(value) {
  return /^[0-9]{1,12}$/.test(String(value || "")) ? String(value) : null;
}

export function jamendoUpstreamDownloadUrl(trackId) {
  return `${JAMENDO_STORAGE_HOST}/download/track/${trackId}/mp32/`;
}

// The URL ZitoAI publishes in search results, in place of the mislabelled upstream one.
export function jamendoProxyDownloadUrl(trackId) {
  const base = config.aspBaseUrl.replace(/\/+$/, "");
  return `${base}/api/providers/jamendo/tracks/${trackId}/download`;
}

// Only ASCII filename characters survive; the header is rebuilt rather than forwarded
// so a crafted upstream filename cannot inject header content.
function safeFileName(trackId, upstreamDisposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(upstreamDisposition || ""));
  const raw = match ? decodeURIComponent(match[1]) : "";
  const cleaned = raw.replace(/[^A-Za-z0-9._ -]/g, "").trim();
  const base = cleaned && cleaned.length > 4 ? cleaned : `jamendo-track-${trackId}.mp3`;
  return base.toLowerCase().endsWith(".mp3") ? base : `${base}.mp3`;
}

export async function streamJamendoDownload(trackId, response, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const upstream = await fetch(jamendoUpstreamDownloadUrl(trackId), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "ZitoAI/0.1 (OKX.AI ASP)" },
    });

    if (!upstream.ok || !upstream.body) {
      const error = new Error(`Jamendo download is unavailable for track ${trackId}`);
      error.status = upstream.status >= 500 ? 502 : 404;
      throw error;
    }

    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_DOWNLOAD_BYTES) {
      const error = new Error("Jamendo download exceeds the supported size");
      error.status = 502;
      throw error;
    }

    response.writeHead(200, {
      ...extraHeaders,
      // Deliberately overridden: the upstream value is text/html for what is an MP3.
      "Content-Type": AUDIO_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${safeFileName(trackId, upstream.headers.get("content-disposition"))}"`,
      ...(declaredLength ? { "Content-Length": String(declaredLength) } : {}),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Upstream-Content-Type": upstream.headers.get("content-type") || "unknown",
    });

    let streamed = 0;
    const source = Readable.fromWeb(upstream.body);
    source.on("data", (chunk) => {
      streamed += chunk.length;
      if (streamed > MAX_DOWNLOAD_BYTES) source.destroy(new Error("Jamendo download exceeded the size ceiling"));
    });

    await new Promise((resolve, reject) => {
      source.pipe(response);
      source.on("error", reject);
      response.on("finish", resolve);
      response.on("error", reject);
    });
  } finally {
    clearTimeout(timeout);
  }
}
