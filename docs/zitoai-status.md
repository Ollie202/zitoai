# ZitoAI status

Last updated: 2026-07-18

ZitoAI is now built as an OKX.AI ASP service with an A2MCP-style API surface.

## Live surface

- Public site: `https://zitoai.xyz`
- Public site alias: `https://www.zitoai.xyz`
- ASP/API host: `https://asp.zitoai.xyz`

## What ZitoAI can do right now

- Parse a plain-language media request into a structured brief.
- Search and rank provider candidates for:
  - images via Shutterstock
  - sound effects / ambience / one-shots via Freesound
  - music tracks via Jamendo
- Show provider-specific policy warnings and licensing caveats.
- Expose provider status endpoints for each source.
- Create an evidence pack (`JSON` or `PDF`) from the selected asset plus user-supplied transaction/licensing evidence.
- Keep procurement history and evidence in Supabase when configured.
- Support provider account connections through OAuth where available.
- Expose a public ASP/A2MCP manifest for OKX.AI marketplace use.

## Verified endpoints

### A2MCP / ASP

- `GET https://asp.zitoai.xyz/.well-known/a2mcp.json`
- `GET https://asp.zitoai.xyz/api/a2mcp`
- `GET https://asp.zitoai.xyz/api/a2mcp/manifest`
- `POST https://asp.zitoai.xyz/api/a2mcp/media-search`
- `POST https://asp.zitoai.xyz/api/a2mcp/evidence-manifest`

### Legacy agent endpoints

- `GET /api/agent`
- `GET /.well-known/agent.json`
- `GET /.well-known/agent-card.json`
- `POST /api/agent/search`

### Provider endpoints

- `GET /api/providers/shutterstock/status`
- `GET /api/providers/shutterstock/categories`
- `GET /api/providers/shutterstock/subscriptions`
- `POST /api/providers/shutterstock/license`
- `GET /api/providers/freesound/status`
- `GET /api/providers/freesound/me`
- `POST /api/providers/freesound/sounds/:id/download`
- `GET /api/providers/jamendo/status`

## What is verified and stable

- A2MCP manifest advertises the ASP base as `asp.zitoai.xyz`.
- Railway custom domain is attached and serving the app on the correct port.
- `www.zitoai.xyz` and `zitoai.xyz` still serve the public site.
- The ASP endpoint is live over HTTPS.
- Local install is current: `npm install` reports up to date with no vulnerabilities.
- Local tests currently pass: `19/19`.

## Latest Railway smoke test

Run date: 2026-07-18

- `GET https://asp.zitoai.xyz/.well-known/a2mcp.json` returned `200` and identified ZitoAI as `role=ASP`, `serviceType=A2MCP`.
- `GET /api/providers/shutterstock/status` returned `200`.
- `GET /api/providers/freesound/status` returned `200`.
- `GET /api/providers/jamendo/status` returned `200`.
- `POST /api/a2mcp/media-search` for an image brief recommended Shutterstock and returned live Shutterstock results with preview and purchase/source links.
- `POST /api/a2mcp/media-search` for a sound-effect brief recommended Freesound and returned live Freesound results with previews.
- Jamendo was hardened after the first smoke test:
  - Freesound no longer competes for `music` requests; it is kept to sound effects / ambience / one-shots.
  - Jamendo now uses stricter music-track filters and richer metadata from the Tracks API.
  - Jamendo now falls back to tag-based discovery when exact commercial search returns zero results.
  - Local live checks returned Jamendo tracks for `upbeat advert music`, `corporate instrumental background`, `cinematic music`, and `ambient music`, each with preview and checkout/handoff URL.
- The public A2MCP `media-search` route now serves the deterministic, no-OpenRouter contract from the build spec, returning normalized results for the selected source.
- The deterministic A2MCP route now applies the spec’s hard gate:
  - Jamendo and Freesound do not appear in commercial `media-search` music results.
  - Jamendo still works for non-commercial music discovery.
  - Every returned result includes a preview URL, license type, price, and attribution flag/text in the normalized shape.

Current honest status: all three provider lanes are now ready for structured Railway endpoint testing. Jamendo remains a checkout-handoff provider, not an API-purchase provider.

## Full prompt smoke test

Run date: 2026-07-18

- 10/10 Shutterstock prompts passed.
- 10/10 Freesound prompts passed.
- 10/10 Jamendo prompts passed.
- Every passing result returned:
  - the correct inferred scope
  - the intended recommended provider
  - a preview URL
  - license terms or license reference
  - a purchase / source / checkout link

This is the first confirmed end-to-end natural-language ASP smoke test for all three provider lanes.

## Shutterstock sanity check

Run date: 2026-07-18

Docs checked:

- `https://www.shutterstock.com/developers/documentation`
- `https://www.shutterstock.com/developers/documentation/authentication`
- `https://www.shutterstock.com/developers/documentation/licensing-and-downloading`

Verified against docs:

- Every Shutterstock API call sends a `User-Agent`.
- Search returns image candidates through the configured Shutterstock API base.
- Categories endpoint returns data.
- Subscriptions endpoint returns data.
- The license request builder includes `image_id`, `subscription_id`, `size`, `format`, `price`, and `metadata.customer_id` where applicable.
- The service auto-selects an active image subscription/format when the caller does not provide `subscriptionId`.
- The real license endpoint refuses mutation unless `confirmLicense=true`.
- Redownload support is implemented through the license-download endpoint, but actual redownload depends on the subscription/license type.

Live read-only check:

- `GET /api/providers/shutterstock/status` returned `200`.
- `GET /api/providers/shutterstock/categories` returned `200` with category data.
- `GET /api/providers/shutterstock/subscriptions` returned `200` with one subscription record.
- `POST /api/a2mcp/media-search` for an image brief returned Shutterstock results with preview, license reference, purchase/source link, and `/api/providers/shutterstock/license` as the next license endpoint.
- `POST /api/providers/shutterstock/license` without `confirmLicense=true` safely returned `400` and did not create a license.

Current honest status: Shutterstock search, metadata, subscription discovery, guarded license execution, and redownload plumbing are implemented. Actual license execution still requires a deliberate `confirmLicense=true` request using the current OAuth token and an eligible API subscription.

## What still needs real user/provider action

- Freesound live OAuth approval still requires the user to connect an actual Freesound account.
- Shutterstock licensing still depends on real access-token / subscription entitlement on the provider side.
- Jamendo public API is read/catalog oriented; the actual music checkout and license certificate step still happens on Jamendo’s web flow, not inside ZitoAI.
- Paid x402 billing is not enabled yet; the ASP currently runs as a free A2MCP-style service.

## Current provider model

- Shutterstock: image licensing and evidence capture.
- Freesound: sound search/preview and original download via OAuth2-backed actions.
- Jamendo: music search/preview plus manual checkout handoff and certificate evidence capture. The connector uses `prolicensing`, music metadata/license includes, artist grouping, track type filters, optional instrumental/speed/content-id-safe hints, and fallback tag discovery.

## Testing schedule from here

1. Baseline platform checks
   - Confirm public site loads: `https://www.zitoai.xyz`
   - Confirm ASP manifest loads: `https://asp.zitoai.xyz/.well-known/a2mcp.json`
   - Confirm legacy agent card loads for compatibility.

2. Provider health checks
   - Shutterstock status, categories, subscriptions.
   - Freesound status and OAuth connection state.
   - Jamendo status and client-id/read-only mode.

3. Search routing checks
   - Image request must route to Shutterstock first.
   - Sound effect / ambience / one-shot request must route to Freesound first.
   - Song / music track request must route to Jamendo first.

4. Provider result quality checks
   - Confirm each result has title, creator/source, preview/source URL, license/policy summary, and provider-specific caveats.
   - Confirm media previews actually play where previews are expected.
   - Confirm “purchase/open provider checkout” links go to the correct provider asset page.

5. Provider action checks without payment
   - Shutterstock: verify license endpoint rejects unsafe/invalid requests cleanly before using a real license action.
   - Freesound: verify OAuth connect flow and original-download eligibility using the logged-in Freesound account.
   - Jamendo: verify external checkout handoff and certificate-evidence fields.

6. Evidence-pack checks
   - Generate JSON evidence pack for one asset from each provider.
   - Generate PDF evidence pack for one asset from each provider.
   - Confirm hashes, provider ID, asset ID, source URLs, license notes, and user evidence are included.

7. Supabase persistence checks
   - Confirm procurements save.
   - Confirm purchase/evidence records save only when provider-backed evidence exists.
   - Confirm incomplete/manual checkout records are clearly marked as handoff, not completed purchase.

8. OKX.AI ASP readiness checks
   - Confirm A2MCP manifest service metadata is correct.
   - Confirm `POST /api/a2mcp/media-search` response is understandable to another agent.
   - Confirm no paid/x402 metadata is advertised until payment integration is intentionally added.

9. Demo rehearsal
   - Run one image demo through Shutterstock.
   - Run one SFX/ambience demo through Freesound.
   - Run one music-track demo through Jamendo handoff.
   - Generate an evidence pack for the strongest demo asset.

10. Payment phase, later
   - Add OKX Agent Payments Protocol / x402 only after the free ASP behavior is stable.
   - Re-test paid endpoint behavior separately so payment bugs do not get confused with provider API bugs.

## OKX.AI registration stance

ZitoAI should be listed as an ASP with A2MCP services. The service contract is intentionally free for now and returns the result directly, which matches the OKX.AI free-endpoint model.

## Working rule for edits

Update this file whenever any of these change:

- endpoint URLs
- provider coverage
- pricing / x402 status
- evidence workflow
- anything that changes what the service can actually do
