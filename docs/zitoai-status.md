# ZitoAI production status

Last updated: 2026-07-20

## Current state

ZitoAI is an OKX.AI ASP and A2MCP API service for rights-aware media search, free to call over x402 and authorized with EIP-3009 `transferWithAuthorization`.

| Item | Status |
|---|---|
| ASP base | Live at https://asp.zitoai.xyz — API only, no website. Serves the A2MCP endpoint, agent card, manifest and health check |
| Agent card | Live at https://asp.zitoai.xyz/.well-known/agent.json |
| A2MCP manifest | Live at https://asp.zitoai.xyz/.well-known/a2mcp.json |
| Primary service endpoint | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |
| Pricing mode | Zero-fee x402 |
| Payment challenge | Enabled with amount `0` |
| Active providers | Shutterstock, Freesound, Jamendo |
| Brain layer | OpenRouter with deterministic fallback |
| Storage | Supabase optional for private history and evidence |

## What the service can do

ZitoAI can:

- Accept natural language media requests from users, agents or OKX.AI callers.
- Accept multilingual briefs, including English, major world languages, Nigerian Pidgin, Yoruba, Igbo and Hausa.
- Preserve the original user request while creating an English provider-ready search query for Shutterstock, Freesound and Jamendo.
- Infer or respect requested media type.
- Route image requests to Shutterstock.
- Route sound effect and ambience requests to Freesound.
- Route music track requests to Jamendo.
- Return normalized results with provider, asset ID, title, creator, preview URL, source URL, license metadata and policy notes.
- Generate PDF or JSON License Evidence Packs from supplied provider and transaction evidence.
- Store private procurement history and evidence when Supabase is configured.
- Expose an A2MCP manifest for OKX.AI registration.
- Return a valid 402 payment challenge on unpaid A2MCP media-search requests.

## What the service does not claim

ZitoAI does not:

- Create legal rights by itself.
- Replace the provider’s license agreement.
- Provide legal advice.
- Claim a paid provider purchase happened unless provider evidence or user supplied checkout evidence is recorded.
- Automatically make Jamendo commercial purchases through the public read API.
- Treat Freesound files as automatically commercial-safe without checking file-level license terms and provider authorization.
- License Shutterstock images unless the configured OAuth token has the correct scopes and account entitlement.

## Provider status

### Shutterstock

Purpose: image search and image licensing support.

Production dependency:

- `SHUTTERSTOCK_ACCESS_TOKEN`
- Correct OAuth scopes: `licenses.create`, `licenses.view`, `purchases.view`
- Active image API subscription or entitlement

Search can work before licensing is fully entitled. Real licensing requires the account and token to be valid for licensing.

### Freesound

Purpose: sound effects and ambience.

Production dependency:

- `FREESOUND_API_KEY`
- `FREESOUND_CLIENT_ID` and `FREESOUND_CLIENT_SECRET` for OAuth-backed account actions

Each result’s own license remains controlling.

### Jamendo

Purpose: music tracks.

Production dependency:

- `JAMENDO_CLIENT_ID`

The public API supports catalog search and metadata. Commercial licensing is handled as a Jamendo checkout or agreement handoff unless a separate commercial API agreement authorizes deeper execution.

## OpenRouter guardrails

The AI layer is intentionally bounded:

- 20 calls per minute
- 12000 input characters per request
- 25 USD cumulative spend per process, overridable with `OPENROUTER_MAX_SPEND_USD`
- deterministic fallback when OpenRouter is unavailable, rate limited, or over budget

The spend ceiling is a defence-in-depth guard on top of the limit set at the OpenRouter key level. It applies per process and resets on restart, so it bounds a runaway loop rather than acting as a billing period cap. Reaching it degrades the service to the local parser; it never fails a request.

Search routes are additionally rate limited to 30 requests per minute per client IP, returning `429` with `Retry-After`.

## Testing checklist

Before registration or production handoff:

1. Run `npm test`.
2. Check `GET https://asp.zitoai.xyz/api/health`.
3. Check `GET https://asp.zitoai.xyz/.well-known/a2mcp.json`.
4. Test one image prompt against `/api/a2mcp/media-search`.
5. Test one sound effect or ambience prompt against `/api/a2mcp/media-search`.
6. Test one music prompt against `/api/a2mcp/media-search`.
7. Confirm unpaid calls to `/api/a2mcp/media-search` return HTTP `402` with an `accepts` array.
8. Confirm Railway has only the production variables listed in `.env.example`.

## Latest endpoint flow test

Date: 2026-07-20

Endpoint tested locally:

```text
POST /api/a2mcp/media-search
```

Test shape:

- 15 languages and moods for Shutterstock image licensing discovery.
- 15 languages and moods for Freesound sound effect and ambience discovery.
- 15 languages and moods for Jamendo music licensing discovery.
- Provider lanes were forced during testing so each provider was validated directly.
- OpenRouter parsing and ranking were active, with calls paced to respect the 20 calls per minute guardrail.

Result:

| Provider | Final result |
|---|---:|
| Shutterstock | 15 / 15 |
| Freesound | 15 / 15 |
| Jamendo | 14 / 15 on full rerun, then the remaining Russian Jamendo case passed on isolated rerun |

Hardening added from this test:

- Multilingual media-type detection for image, sound effect and music prompts.
- Search fallback handling for translated or non-English provider queries.
- Top-level `licenseUrl` fields on provider results so agents can find license links without inspecting nested metadata.
- Retry handling for transient provider fetch failures.

Current multilingual behavior:

- OpenRouter/Gemini parses incoming language, usage, mood, keywords and media type.
- The backend stores `originalQuery`, `sourceLanguage`, `translated`, and provider-ready English `query` in the normalized brief.
- Local fallback includes basic support for Nigerian Pidgin, Yoruba, Igbo and Hausa media cues when OpenRouter is unavailable.
- Responses carry the detected language, the provider search query and the original request, so a caller can show all three when they differ.

Verified end to end after the structured-output fix:

| Request | Source language | Provider query | Result |
|---|---|---|---|
| `mo nilo orin ayeye ojo ibi` | Yoruba | `birthday celebration music` | Jamendo — "Birthday Celebration" |
| `我需要生日快乐的音乐` | Chinese | `Happy birthday music` | Jamendo — "Happy Birthday" |
| `ina bukatar wakar bikin haihuwa` | Hausa | `birthday celebration music` | Jamendo |
| `a photo of a window at sunset` | English | `window sunset` | Shutterstock |
| `rain ambience for meditation` | English | unchanged | Freesound |

Latest x402 reviewer fix:

The listing was rejected for not using EIP-3009 as the payment authorization method. It was not: the endpoint gated on the *presence* of a payment header, so `X-PAYMENT: anything` returned a real search result. No signature was recovered, no nonce tracked, no facilitator consulted.

- The challenge is x402 v2, base64 in the `PAYMENT-REQUIRED` header (the marketplace validates the header, not the body).
- The single `accepts` entry carries exactly the seven documented `PaymentRequirements` fields. `extra` is `{name, version}` — the token's EIP-712 domain, and the way the OKX SDK encodes EIP-3009. It emits `assetTransferMethod` only for assets whose method is not the default, and its registry entry for `eip155:196` declares none; the facilitator's own `/supported` lists `exact` on `eip155:196` with `extra: null` alongside a separate `permit2` variant.
- Replays are verified: the signer is recovered over the `TransferWithAuthorization` struct against the token's EIP-712 domain, checked against the published offer, time-windowed, replay-protected on `(from, nonce)`, and then confirmed by the OKX facilitator before any work is done.
- The accepted asset is X Layer USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, confirmed on chain to implement EIP-3009 (`TRANSFER_WITH_AUTHORIZATION_TYPEHASH` returns the canonical `0x7c7c6cdb…`; `permit()` reverts).
- The amount is `0`, matching the free listing. Verified against the live facilitator that this does not weaken anything: at amount 0 it still returns `invalid_signature` for a forged `from`, a garbage signature or a rewritten `to`, and validates only an honest authorization. Settlement is skipped because nothing moves, and the receipt says `no_settlement_required` rather than claiming a transaction.
- `node scripts/x402-selfcheck.mjs <base-url>` reproduces all of the above against a running deployment.

Honest limitation:

The endpoint returns provider licensing, source and checkout links. It does not claim that a paid provider purchase has happened unless a real provider license action or external checkout evidence is recorded.

## Current registration copy

ASP description:

```text
ZitoAI helps users quickly find licensable images, sound effects, music tracks, and ambience for real creative work. It understands natural language requests, searches the most relevant provider, filters the results, and returns the strongest matches with the licensing details needed to move from idea to usable asset.
```

Service description:

```text
ZitoAI provides free x402 access to a rights-aware media search and licensing assistant. It takes a natural language request, understands the intended use, searches the most relevant provider, filters the results by media type and usage fit, and returns the strongest matches for images, sound effects, music tracks, and ambience with the licensing details needed to choose the right asset.
```

## Remaining operational work

- Re-run OKX x402 validation against the live Railway deployment after this fix is deployed.
- Keep provider tokens fresh in Railway.
- Rotate any provider secrets that were exposed in screenshots or chat.
- Set `OKX_API_KEY`, `OKX_SECRET_KEY` and `OKX_PASSPHRASE` in Railway — without them every paid call fails closed with `503`.
- Keep the OKX.AI listing fee and `OKX_PAYMENT_AMOUNT` in step. Both are currently `0`; raising one without the other will not reconcile at review.
- `/api/search` and `/api/agent/search` are gated by the same EIP-3009 authorization as the A2MCP route.
- Run `node scripts/x402-selfcheck.mjs https://asp.zitoai.xyz` after deploying, before resubmitting for review.
