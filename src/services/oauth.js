import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { authenticatedUser, saveProviderConnection } from "./supabase.js";
import { fetchJson } from "../lib/http.js";

const providers = {
  freesound: {
    authorizeUrl: "https://freesound.org/apiv2/oauth2/authorize/",
    tokenUrl: "https://freesound.org/apiv2/oauth2/access_token/",
    clientId: () => config.oauth.freesound.clientId,
    clientSecret: () => config.oauth.freesound.clientSecret,
    scope: () => "",
  },
  shutterstock: {
    authorizeUrl: () => config.oauth.shutterstock.authorizeUrl,
    tokenUrl: () => config.oauth.shutterstock.tokenUrl,
    clientId: () => config.oauth.shutterstock.clientId,
    clientSecret: () => config.oauth.shutterstock.clientSecret,
    scope: () => config.oauth.shutterstock.scopes,
  },
};

export function oauthStatus() {
  return Object.fromEntries(Object.entries(providers).map(([id, provider]) => [id, {
    configured: Boolean(value(provider.authorizeUrl) && value(provider.tokenUrl) && provider.clientId() && provider.clientSecret()),
    callbackUrl: callbackUrl(id),
  }]));
}

export async function startOAuth(request, providerId) {
  const provider = getProvider(providerId);
  const user = await authenticatedUser(request);
  assertOAuthSecrets();
  const state = signState({ provider: providerId, userId: user.id, exp: Date.now() + 10 * 60_000, nonce: randomBytes(12).toString("hex") });
  const url = new URL(value(provider.authorizeUrl));
  url.searchParams.set("client_id", provider.clientId());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callbackUrl(providerId));
  url.searchParams.set("state", state);
  if (provider.scope()) url.searchParams.set("scope", provider.scope());
  return { provider: providerId, authorizeUrl: url.toString(), callbackUrl: callbackUrl(providerId) };
}

export async function completeOAuth(providerId, params) {
  const provider = getProvider(providerId);
  assertOAuthSecrets();
  if (params.error) throw new Error(params.error_description || params.error);
  if (!params.code || !params.state) throw new Error("OAuth callback is missing code or state.");
  const state = verifyState(params.state);
  if (state.provider !== providerId || state.exp < Date.now()) throw new Error("OAuth state is invalid or expired.");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: provider.clientId(),
    client_secret: provider.clientSecret(),
    code: params.code,
    redirect_uri: callbackUrl(providerId),
  });
  const token = await fetchJson(value(provider.tokenUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    timeoutMs: 20_000,
  });
  const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
  await saveProviderConnection(state.userId, providerId, {
    scopes: String(token.scope || provider.scope() || "").split(/[ ,]+/).filter(Boolean),
    accessTokenCiphertext: encrypt(token.access_token),
    refreshTokenCiphertext: token.refresh_token ? encrypt(token.refresh_token) : null,
    expiresAt,
    metadata: { tokenType: token.token_type || "Bearer" },
  });
  return { provider: providerId, expiresAt };
}

function getProvider(id) {
  const provider = providers[id];
  if (!provider) throw new Error("Unsupported OAuth provider.");
  if (!value(provider.authorizeUrl) || !value(provider.tokenUrl) || !provider.clientId() || !provider.clientSecret()) throw new Error(`${id} OAuth is not configured.`);
  return provider;
}

function callbackUrl(providerId) { return `${config.oauth.callbackBaseUrl.replace(/\/$/, "")}/auth/${providerId}/callback`; }
function value(item) { return typeof item === "function" ? item() : item; }

function assertOAuthSecrets() {
  if (!config.oauth.stateSecret || !config.oauth.tokenEncryptionKey) throw new Error("OAuth security secrets are not configured.");
}

function signState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", config.oauth.stateSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state) {
  const [encoded, signature] = String(state).split(".");
  const expected = createHmac("sha256", config.oauth.stateSecret).update(encoded || "").digest("base64url");
  if (!encoded || !signature || signature.length !== expected.length || !timingSafe(signature, expected)) throw new Error("OAuth state verification failed.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function timingSafe(a, b) {
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function encrypt(valueToEncrypt) {
  const key = createHmac("sha256", config.oauth.tokenEncryptionKey).update("zito-oauth-token-v1").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(valueToEncrypt), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}
