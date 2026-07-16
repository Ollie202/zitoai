# License Hunter — end-to-end architecture

## Product promise

License Hunter turns a natural-language media request into a rights-aware procurement plan. It does not pretend that one API or one Creative Commons label answers every licensing question. It preserves the provider's original evidence and applies the provider's own rules before any purchase or delivery.

## System boundary

```text
User / OKX.AI task
        |
        v
Intent layer (local parser -> OpenRouter enhancement)
        |
        v
Procurement brief + explicit user constraints
        |
        v
Provider router -------------------- Provider capability catalog
        |                                      |
        v                                      v
Search adapters (public/gated)        Credential and approval state
        |
        v
Normalized assets
        |
        v
Deterministic rights policy engine
        |
        +--> rejected / review / checkout-only
        |
        v
Ranked shortlist + rights explanation
        |
        v
User approval gate
        |
        +--> provider checkout / customer OAuth
        +--> OKX Agent Payments Protocol (x402)
        |
        v
License evidence bundle + asset delivery
```

## Core rule

The model may interpret language, expand search terms and rank candidates. It must not invent permission. Every provider has a policy profile and every result is screened after retrieval.

## Normalized procurement brief

```ts
type ProcurementBrief = {
  query: string;
  assetType: "music" | "sound_effect" | "image" | "video";
  intendedUse: string;
  commercial: boolean;
  broadcast: boolean;
  rawAssetRequired: boolean;
  territory: string;
  budgetUsd: number | null;
  keywords: string[];
};
```

Later fields to add:

- duration/length
- audience size
- platforms and monetization
- modification/editing required
- attribution tolerance
- customer legal name
- customer country
- delivery format/resolution
- deadline

## Provider adapter contract

Every connector should implement:

```ts
{
  id,
  name,
  status,
  requiresApiKey,
  supportedAssetTypes,
  search(brief, limit),
  getDetails?(assetId),
  getRights?(assetId, brief),
  createCheckout?(assetId, customer),
  license?(assetId, customer, paymentContext),
  download?(license),
  buildEvidence?(license)
}
```

The public MVP implements `search`, and Stockfilm implements a public rights check. Authenticated adapters are represented in the capability catalog so they can be added without changing the API shape.

## Provider states

- `live_public_connector`: callable without signup now.
- `credential_required`: API key/OAuth is needed.
- `approval_required`: API key may be free, but provider approval or an enterprise relationship is needed.
- `free_test_images_only`: test access is not a production multimedia entitlement.
- `partner_required_for_production`: free prototype access does not authorize launch.
- `paid_api`: violates the current free-access MVP assumption.
- `no_documented_api`: do not scrape; request an official feed or permission.
- `not_a_media_provider`: useful only as a rights/metadata aid.

## Licensing modes

### Mode A — customer checkout handoff

The agent searches and explains. The user opens the provider checkout and becomes the licensee. This is the safest mode for Free To Use, Adobe Stock and any provider whose terms prohibit transfer.

### Mode B — customer OAuth

The customer signs into the provider. The provider licenses to the customer's account. This is the preferred Adobe/enterprise pattern.

### Mode C — authorized procurement for a named customer

The agent pays using an approved account or x402 wallet, but the provider explicitly records the end customer as licensee. MotionElements' pay-per-item licensee change is an example. This requires provider confirmation and an audit trail.

### Mode D — agent-owned license

Do not use this as a default. A license purchased by License Hunter cannot automatically be transferred, sublicensed or redistributed to an end customer.

## Evidence bundle

Store an immutable record containing:

- request and normalized brief
- provider, asset ID and source URL
- provider terms URL and terms version/date
- license type and scope
- customer/licensee identity
- checkout/license ID and receipt
- payment transaction hash, network and token
- rights-check response
- attribution and ShareAlike instructions
- original download URL expiry
- SHA-256 of downloaded asset
- timestamp and connector version

Call this a **License Evidence Pack**, not a License Hunter license.

## Payment architecture

The payment module is separate from search. It must:

1. Display provider, asset, price, network, token, recipient and customer/licensee before payment.
2. Require explicit user confirmation for every payment.
3. Use the OKX Agent Payments Protocol for x402 challenges instead of hand-assembling signatures.
4. Replay the provider request with the returned authorization header.
5. Store payment and provider license IDs together.
6. Never pay for a non-transferable asset unless the customer is the provider-recognized licensee.

## Security model

- Provider API keys stay server-side in environment variables or a secret manager.
- The browser never receives provider keys or wallet secrets.
- Do not log Authorization headers, payment challenges or downloaded raw assets.
- Keep previews separate from licensed downloads.
- Use short-lived signed download URLs.
- Hash evidence, but do not publish customer personal information.
- Rate-limit each provider independently.
- Cache metadata, not raw files, unless the provider terms permit temporary processing.
- Add SSRF protection before accepting arbitrary provider URLs.

## Failure and fallback behavior

- Provider timeout: mark provider unavailable and continue with fallbacks.
- Missing license metadata: reject or require manual review.
- Ambiguous license: never convert it to `allowed` using an LLM.
- Payment succeeds but download fails: preserve receipt/license ID and provide a re-download path if the provider permits it.
- Licensee mismatch: stop delivery and require provider/customer correction.
- Terms change: invalidate cached policy and require re-check.

## 16-hour execution plan

### Hours 0–2: foundation (complete)

- normalized brief
- provider contract
- public connectors
- deterministic policy engine
- local UI

### Hours 2–5: provider access

- create provider accounts
- request Adobe, MotionElements and partner credentials
- test Shutterstock free image account
- obtain Freesound/Jamendo keys
- record every approval and limitation in `.env.example` and the provider matrix

### Hours 5–8: intent and ranking

- add OpenRouter key
- enforce structured JSON output
- add missing-field questions
- add provider-specific query expansion
- cache normalized briefs and provider metadata

### Hours 8–11: procurement

- implement customer checkout links
- implement customer identity/licensee fields
- add MotionElements pay-per-item flow if approved
- add Adobe customer OAuth if approved
- add Stockfilm x402 only after licensee confirmation

### Hours 11–14: evidence and safety

- evidence-pack storage
- asset hashing
- receipts and provider terms snapshots
- retry/rate-limit handling
- payment confirmation UI

### Hours 14–16: demo hardening

- scripted demo scenarios
- provider failure fallback
- no-key demo mode
- final legal caveats
- deployment and handoff checklist
