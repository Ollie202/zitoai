import { config } from "../config.js";

// Replay protection for EIP-3009 authorizations.
//
// The chain is the final authority: transferWithAuthorization records each nonce against
// the payer, so a settled authorization can never be settled twice. That guarantee only
// lands once the transaction confirms, which leaves a window in which the same signed
// header could be replayed against us and served repeatedly before the first settlement
// lands. This store closes that window locally, so the work is done at most once per
// authorization.
//
// Keyed on (from, nonce) rather than nonce alone: the nonce is chosen by the payer and is
// only required to be unique per payer, so two payers may legitimately pick the same one.
const seen = new Map();

// A nonce cannot be replayed after its own validBefore has passed, so entries are only
// worth keeping for the signature window. The extra hour absorbs clock skew between us
// and the payer, and keeps a settled nonce rejected for a while after it expires.
const RETENTION_MS = (config.payment.maxTimeoutSeconds + 3600) * 1000;

function key(from, nonce) {
  return `${String(from).toLowerCase()}:${String(nonce).toLowerCase()}`;
}

function prune(now) {
  for (const [entry, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(entry);
  }
}

/**
 * Claims an authorization for this request. Returns false when the pair has already been
 * claimed, which means a replay.
 *
 * The claim is taken *before* the work is done rather than after, so two concurrent
 * replays cannot both pass the check and both be served.
 */
export function claimNonce(from, nonce) {
  const now = Date.now();
  prune(now);

  const entry = key(from, nonce);
  if (seen.has(entry)) return false;

  seen.set(entry, now + RETENTION_MS);
  return true;
}

/**
 * Releases a claim. Called when settlement fails, because the payer was not charged and
 * their authorization is still theirs to spend — holding the claim would burn a nonce
 * they never got anything for.
 */
export function releaseNonce(from, nonce) {
  seen.delete(key(from, nonce));
}

export function nonceStoreSize() {
  return seen.size;
}

// Test seam. The store is process-local, so a test that claims a nonce would otherwise
// leak into the next one.
export function resetNonceStore() {
  seen.clear();
}
