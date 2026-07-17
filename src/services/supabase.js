import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

const configured = Boolean(config.supabase.url && config.supabase.anonKey);
const adminConfigured = Boolean(configured && config.supabase.serviceRoleKey);

export function storageStatus() {
  return {
    configured,
    adminConfigured,
    bucket: config.supabase.evidenceBucket,
  };
}

export async function authenticatedUser(request) {
  const { user } = await authenticatedClient(request);
  return user;
}

export async function saveProviderConnection(userId, provider, connection) {
  if (!adminConfigured) throw new Error("Supabase service role is not configured.");
  const { error } = await adminClient()
    .from("provider_connections")
    .upsert({
      owner_id: userId,
      provider,
      provider_account_id: connection.providerAccountId || null,
      account_label: connection.accountLabel || null,
      scopes: connection.scopes || [],
      status: "connected",
      access_token_ciphertext: connection.accessTokenCiphertext,
      refresh_token_ciphertext: connection.refreshTokenCiphertext || null,
      expires_at: connection.expiresAt || null,
      metadata: connection.metadata || {},
    }, { onConflict: "owner_id,provider" });
  if (error) throw new Error(error.message);
}

export async function listProviderConnections(request) {
  const { user } = await authenticatedClient(request);
  return queryProviderConnections(user.id);
}

export async function getProviderConnection(request, provider) {
  const { user } = await authenticatedClient(request);
  const connections = await queryProviderConnections(user.id, provider);
  return connections[0] || null;
}

export async function createProcurement(request, payload) {
  const { client, user } = await authenticatedClient(request);
  const { data, error } = await client
    .from("procurement_jobs")
    .insert({
      owner_id: user.id,
      request_text: String(payload.requestText || payload.query || "").trim(),
      request_payload: payload.requestPayload || payload,
      normalized_brief: payload.normalizedBrief || {},
      status: payload.status || "draft",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listProcurements(request) {
  const { client } = await authenticatedClient(request);
  const { data, error } = await client
    .from("procurement_jobs")
    .select("*, purchase_records(*), license_records(*), evidence_artifacts(*)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getProcurement(request, id) {
  const { client } = await authenticatedClient(request);
  const { data, error } = await client
    .from("procurement_jobs")
    .select("*, purchase_records(*), license_records(*), evidence_artifacts(*)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function recordPurchase(request, jobId, payload) {
  const { client } = await authenticatedClient(request);
  const { data, error } = await client.rpc("record_purchase_bundle", {
    p_job_id: jobId,
    p_purchase: payload.purchase || {},
    p_license: payload.license || {},
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createEvidenceUpload(request, jobId, payload) {
  if (!adminConfigured) throw new Error("Supabase service role is not configured.");
  const { client, user } = await authenticatedClient(request);
  await assertJobOwnership(client, jobId);

  const safeName = String(payload.fileName || "evidence.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-120);
  const path = `${user.id}/${jobId}/${randomUUID()}-${safeName}`;
  const admin = adminClient();
  const { data, error } = await admin.storage
    .from(config.supabase.evidenceBucket)
    .createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { ...data, path };
}

export async function registerEvidence(request, jobId, payload) {
  const { client, user } = await authenticatedClient(request);
  await assertJobOwnership(client, jobId);
  const requiredPrefix = `${user.id}/${jobId}/`;
  if (!String(payload.storagePath || "").startsWith(requiredPrefix)) {
    throw new Error("Evidence path does not belong to this procurement.");
  }
  const { data, error } = await client
    .from("evidence_artifacts")
    .insert({
      owner_id: user.id,
      job_id: jobId,
      purchase_id: payload.purchaseId || null,
      license_id: payload.licenseId || null,
      artifact_type: payload.artifactType || "other",
      storage_bucket: config.supabase.evidenceBucket,
      storage_path: payload.storagePath,
      original_name: payload.originalName || null,
      content_type: payload.contentType || null,
      byte_size: payload.byteSize || null,
      sha256: payload.sha256 || null,
      source_url: payload.sourceUrl || null,
      metadata: payload.metadata || {},
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function authenticatedClient(request) {
  if (!configured) throw new Error("Supabase is not configured.");
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
  const token = authorization.slice(7);
  const client = createClient(config.supabase.url, config.supabase.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired session.");
  return { client, user: data.user };
}

async function assertJobOwnership(client, jobId) {
  const { data, error } = await client
    .from("procurement_jobs")
    .select("id")
    .eq("id", jobId)
    .single();
  if (error || !data) throw new Error("Procurement not found.");
}

function adminClient() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function queryProviderConnections(ownerId, provider = null) {
  if (!adminConfigured) throw new Error("Supabase service role is not configured.");
  let query = adminClient()
    .from("provider_connections")
    .select("provider, provider_account_id, account_label, scopes, status, expires_at, metadata, updated_at")
    .eq("owner_id", ownerId)
    .order("provider", { ascending: true });
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
