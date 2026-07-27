# ZitoAI production status

Last updated: 2026-07-27

## Current state

ZitoAI is an OKX.AI ASP and zero-priced A2MCP API service for rights-aware media search. The marketplace fee remains `0 USDT`; the endpoint uses the official OKX x402 seller SDK and an EIP-3009 authorization before returning results.

| Item | Status |
|---|---|
| ASP base | Live at https://asp.zitoai.xyz — API only, no website. Serves the A2MCP endpoint, agent card, manifest and health check |
| Agent card | Live at https://asp.zitoai.xyz/.well-known/agent.json |
| A2MCP manifest | Live at https://asp.zitoai.xyz/.well-known/a2mcp.json |
| Primary service endpoint | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |
| Pricing mode | `0 USDT` per call |
| Payment challenge | x402 v2 on the listed route; `exact` EIP-3009 amount `0` |
| Seller integration | Official `@okxweb3/x402-*` SDK packages and OKX facilitator verification |
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
- Return results on the signed replay of the zero-priced A2MCP media-search endpoint.

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
7. Confirm an unsigned call returns `402` and `PAYMENT-REQUIRED`; confirm a signed EIP-3009 replay returns `200`, `PAYMENT-RESPONSE`, an `X-Request-Id`, and a result array.
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

Latest reviewer remediation:

- The registered fee remains `0 USDT`, but the listed endpoint now uses the official OKX seller SDK instead of bypassing payment middleware.
- Unsigned POST requests return a standards-shaped x402 v2 `402` challenge in `PAYMENT-REQUIRED`.
- The accepted asset is X Layer USD₮0 and the authorization is EIP-3009 `transferWithAuthorization` with amount `0`.
- The handler runs only after OKX facilitator verification of the signed replay; it then returns the media results with `PAYMENT-RESPONSE`.
- Zero-value settlement returns a truthful SDK-shaped zero receipt after verification and does not fabricate an on-chain token transfer.
- Every request has an `X-Request-Id` and structured start, success, failure, duration, provider, and result-count logs.
- `A2MCP_SEARCH_TIMEOUT_MS` bounds the synchronous request; the default is 45 seconds.
- `npm run smoke:a2mcp -- <base-url>` creates a real signed EIP-3009 authorization with an ephemeral test account and checks the challenge, replay, receipt, result contract, and latency.
- Old accepted marketplace tasks do not become deliverable retroactively. Verification must use a fresh call after the deployment and listing metadata update.
- An attempted ASP-side recovery of an old accepted `paymentMode=3` job was rejected by the Onchain OS CLI itself: x402 jobs do not support ASP `deliver` or status-2 submission. The user agent obtains the endpoint result and calls `direct/complete`. Adding an on-chain submit write to this API would implement the wrong lifecycle.

Honest limitation:

The endpoint returns provider licensing, source and checkout links. It does not claim that a paid provider purchase has happened unless a real provider license action or external checkout evidence is recorded.

## Current registration copy

ASP description:

```text
ZitoAI helps users quickly find licensable images, sound effects, music tracks, and ambience for real creative work. It understands natural language requests, searches the most relevant provider, filters the results, and returns the strongest matches with the licensing details needed to move from idea to usable asset.
```

Service description:

```text
ZitoAI provides zero-priced access to a rights-aware media search and licensing assistant. It takes a natural language request, understands the intended use, searches the most relevant provider, filters the results by media type and usage fit, and returns the strongest matches for images, sound effects, music tracks, and ambience with the licensing details needed to choose the right asset.
```

## Remaining operational work

- Deploy the official-SDK zero-price remediation and run the signed production smoke check before resubmitting.
- Keep provider tokens fresh in Railway.
- Rotate any provider secrets that were exposed in screenshots or chat.
- ASP #6931 already records the service as an API service with a `0 USDT` fee and the correct endpoint. No identity update is required for this fix.
- `/api/search` and `/api/agent/search` share the same x402 middleware so no compatibility path bypasses verification.
- Run `npm run smoke:a2mcp -- https://asp.zitoai.xyz` before requesting another review and after future production changes.
