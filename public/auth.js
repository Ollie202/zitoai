let client = null;
let currentSession = null;
const listeners = new Set();

export async function initAuth() {
  const response = await fetch("/api/config");
  const config = await response.json();
  if (!config.supabase?.configured) return { configured: false };
  // Pinned to an exact version rather than the `@2` range. This module runs in the page
  // with access to the session token, so an unpinned import means any future 2.x
  // published to the CDN executes here without review. Bump this deliberately.
  //
  // Remaining risk, accepted knowingly: the code is still fetched from a third party at
  // runtime, so a CDN outage breaks sign-in and a CDN compromise would be serious. The
  // durable fix is to serve the library from this origin.
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.110.6");
  client = createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  const { data } = await client.auth.getSession();
  currentSession = data.session;
  client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    for (const listener of listeners) listener(session);
  });
  return { configured: true, session: currentSession };
}

export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession() {
  return currentSession;
}

export function getAccessToken() {
  return currentSession?.access_token || null;
}

export async function sendMagicLink(email) {
  if (!client) throw new Error("Account storage is not configured yet.");
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/` },
  });
  if (error) throw error;
}

export async function signOut() {
  if (client) await client.auth.signOut();
}
