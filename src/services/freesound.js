import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { decryptToken } from "./oauth.js";
import { getProviderConnection, saveProviderConnection, authenticatedUser } from "./supabase.js";

const API_BASE = "https://freesound.org/apiv2";

export function freesoundStatus() {
  return {
    configured: Boolean(config.credentials.freesound.apiKey),
    oauthConfigured: Boolean(config.oauth.freesound.clientId && config.oauth.freesound.clientSecret),
    originalDownloadEndpoint: "/api/providers/freesound/sounds/:soundId/download",
    meEndpoint: "/api/providers/freesound/me",
  };
}

export async function getFreesoundAccount(request) {
  const connection = await getFreesoundConnection(request);
  if (!connection) return null;
  return {
    provider: "freesound",
    accountLabel: connection.account_label || null,
    providerAccountId: connection.provider_account_id || null,
    scopes: connection.scopes || [],
    expiresAt: connection.expires_at || null,
    status: connection.status || "connected",
    metadata: connection.metadata || {},
  };
}

export async function getFreesoundMe(request) {
  const accessToken = await getValidOAuthAccessToken(request);
  return fetchJson(`${API_BASE}/me/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 20_000,
  });
}

export async function downloadFreesoundOriginal(request, soundId) {
  const accessToken = await getValidOAuthAccessToken(request);
  const id = String(soundId || "").trim();
  if (!id) throw new Error("Freesound soundId is required");
  const response = await fetch(`${API_BASE}/sounds/${encodeURIComponent(id)}/download/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "*/*",
      "User-Agent": "ZitoAI/0.1 (OKX.AI hackathon prototype)",
    },
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    return { provider: "freesound", soundId: id, downloadUrl: location };
  }

  if (response.ok && response.url) {
    return { provider: "freesound", soundId: id, downloadUrl: response.url };
  }

  const body = await response.text();
  throw new Error(body || `Freesound download failed with HTTP ${response.status}`);
}

async function getFreesoundConnection(request) {
  await authenticatedUser(request);
  return getProviderConnection(request, "freesound");
}

async function getValidOAuthAccessToken(request) {
  const user = await authenticatedUser(request);
  const connection = await getProviderConnection(request, "freesound");
  if (!connection) throw new Error("Connect your Freesound account first.");
  const expiresAt = connection.expires_at ? Date.parse(connection.expires_at) : null;
  if (!expiresAt || expiresAt - Date.now() > 5 * 60_000) {
    return decryptToken(connection.access_token_ciphertext);
  }
  if (!connection.refresh_token_ciphertext) {
    return decryptToken(connection.access_token_ciphertext);
  }

  const refreshToken = await decryptToken(connection.refresh_token_ciphertext);
  const form = new URLSearchParams({
    client_id: config.oauth.freesound.clientId,
    client_secret: config.oauth.freesound.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const token = await fetchJson("https://freesound.org/apiv2/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    timeoutMs: 20_000,
  });
  const newExpiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
  await saveProviderConnection(user.id, "freesound", {
    providerAccountId: connection.provider_account_id || null,
    accountLabel: connection.account_label || null,
    scopes: String(token.scope || connection.scopes || "").split(/[ ,]+/).filter(Boolean),
    accessTokenCiphertext: encryptLike(connection.access_token_ciphertext, token.access_token),
    refreshTokenCiphertext: token.refresh_token ? encryptLike(connection.refresh_token_ciphertext, token.refresh_token) : connection.refresh_token_ciphertext,
    expiresAt: newExpiresAt,
    metadata: { ...(connection.metadata || {}), tokenType: token.token_type || "Bearer", refreshedAt: new Date().toISOString() },
  });
  return token.access_token;
}

function encryptLike(ciphertextSample, value) {
  const [version, ivValue, authTagValue] = String(ciphertextSample || "").split(":");
  if (!version || !ivValue || !authTagValue) return ciphertextSample;
  const key = createHmac("sha256", config.oauth.tokenEncryptionKey).update("zito-oauth-token-v1").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}
