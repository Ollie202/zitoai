let client = null;
let currentSession = null;
const listeners = new Set();

export async function initAuth() {
  const response = await fetch("/api/config");
  const config = await response.json();
  if (!config.supabase?.configured) return { configured: false };
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
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
