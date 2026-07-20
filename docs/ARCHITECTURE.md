# ZitoAI architecture

ZitoAI is a rights-aware media search ASP for OKX.AI. It exposes one free A2MCP API service that accepts natural language media requests and returns provider-backed candidates with licensing metadata.

## Product boundary

ZitoAI helps users discover licensable media and understand the next licensing step. It does not create rights, transfer rights, provide legal advice, or claim that a provider purchase happened unless provider evidence or user supplied checkout evidence exists.

## Runtime flow

```text
Agent or user request
        |
        v
A2MCP endpoint
        |
        v
Brief parser
        |
        v
Provider router
        |
        +--> Shutterstock for images
        +--> Freesound for sound effects and ambience
        +--> Jamendo for music tracks
        |
        v
Provider adapters
        |
        v
Normalized media candidates
        |
        v
Policy screen and evidence metadata
        |
        v
A2MCP response with results, scopes, license metadata, previews and next step
```

## Public API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Runtime status for brain, storage, OAuth and payment mode |
| `GET` | `/.well-known/a2mcp.json` | OKX.AI A2MCP service manifest |
| `POST` | `/api/a2mcp/media-search` | Primary ASP endpoint for agents |
| `POST` | `/api/search` | Browser search endpoint |
| `POST` | `/api/brief` | Brief normalization endpoint |
| `GET` | `/api/providers` | Provider configuration status |
| `POST` | `/api/evidence-pack` | JSON or PDF evidence export |

Provider-specific support endpoints exist for OAuth, Shutterstock licensing, Freesound original download, and procurement evidence storage.

## Normalized brief

```ts
type ProcurementBrief = {
  query: string;
  assetType: "image" | "sound_effect" | "music";
  intendedUse: string;
  commercial: boolean;
  broadcast: boolean;
  rawAssetRequired: boolean;
  territory: string;
  budgetUsd: number | null;
  keywords: string[];
};
```

## Provider adapter contract

Each provider adapter returns normalized candidates with this shape:

```ts
type MediaCandidate = {
  id: string;
  provider: "shutterstock" | "freesound" | "jamendo";
  title: string;
  creator: string;
  assetType: "image" | "sound_effect" | "music";
  previewUrl: string | null;
  mediaUrl: string | null;
  sourceUrl: string;
  purchaseUrl: string | null;
  priceUsd: number | null;
  license: {
    code: string | null;
    name: string | null;
    url: string | null;
    attributionRequired: boolean;
  };
  metadata: Record<string, unknown>;
};
```

## Provider responsibilities

### Shutterstock

Used for image results and image licensing workflows. Search uses the configured Shutterstock access token. Real licensing requires an OAuth access token with the correct license scopes and an active image API subscription.

### Freesound

Used for sound effects and ambience. Search and previews use the API token. OAuth is used for user-account actions such as original-file download when authorized. Each sound’s own license remains the controlling license.

### Jamendo

Used for music tracks. The public developer API supports catalog search and metadata. Commercial use is handled as a Jamendo licensing handoff unless the account has a separate commercial agreement that authorizes deeper execution.

## Brain layer

OpenRouter improves intent parsing, provider routing, keyword expansion and ranking. It is bounded by guardrails:

- 20 calls per minute
- 12000 input characters per request
- deterministic fallback when OpenRouter is unavailable

The model can improve interpretation and ranking. It cannot override provider policies or invent licensing permission.

## Storage and evidence

Supabase stores private procurement records, provider connections, purchases and evidence artifacts when configured. Evidence Packs can also be generated locally as PDF or JSON without requiring a signed-in user.

Evidence Packs record:

- request and normalized brief
- provider, asset ID and source URL
- license metadata and controlling URL
- policy verdict and warnings
- purchase or checkout evidence if supplied
- generated hash

An Evidence Pack is proof of recorded evidence, not a replacement license.

## Payment mode

The current A2MCP service is free and returns `200` without an x402 challenge. OKX payment SDK packages are not required for this production mode.

Provider purchases, if performed later, must still be explicitly confirmed and backed by provider evidence. The free A2MCP call does not mean provider assets are free to use.

## Security model

- Provider secrets stay in server environment variables.
- Browser code never receives provider secrets, service role keys or wallet credentials.
- Authorization headers and OAuth tokens must not be logged.
- Raw media delivery is only allowed when provider terms permit it.
- Metadata can be cached; raw assets should not be cached unless provider terms allow it.
- User supplied evidence is recorded as evidence, not treated as automatically verified.
