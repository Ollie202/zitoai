# License Hunter provider documentation

License Hunter is an evidence-first asset procurement agent. It searches public catalogs, applies deterministic license-policy checks, and returns the original provider links and license terms. It does **not** issue a replacement license or provide legal advice.

## Request lifecycle

1. The user describes the asset and intended use.
2. The local brief parser (or OpenRouter, when configured) normalizes the request.
3. Provider connectors search only the providers compatible with the asset type.
4. A deterministic routing layer ranks the most likely provider before querying fallbacks.
5. The policy engine screens commercial use, attribution, transfer and source-verification constraints.
6. Results are marked `allowed`, `review`, `checkout_only` or `rejected`.
7. Paid purchasing is deliberately not exposed by the public-search MVP. A later payment module must enforce the OKX confirmation gate and identify the customer/licensee before delivery.

## Run it

```powershell
Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>.

No API keys are required for the current public connectors. The service uses Node's built-in `fetch`; there is no dependency-install step.

## API surface

### `GET /api/health`

Returns service version and whether OpenRouter is configured.

### `GET /api/providers`

Returns public connector metadata and whether each connector requires credentials.

### `POST /api/brief`

Normalizes a user request. Example:

```json
{
  "query": "dark cinematic music for a 30 second commercial",
  "assetType": "music",
  "intendedUse": "commercial_content",
  "budgetUsd": 20
}
```

### `POST /api/search`

Runs the public connectors concurrently and applies policy checks:

```json
{
  "query": "vintage beach footage",
  "assetType": "video",
  "intendedUse": "commercial_content",
  "budgetUsd": 25,
  "limit": 6,
  "providers": ["stockfilm", "wikimedia"]
}
```

## Important policy decisions

### Free To Use

Search is public. Its license is non-transferable, so the result is always `checkout_only`. The agent must not download under its own identity and forward the raw song to a customer.

### Openverse

Openverse is an aggregator and does not verify the original license. Results are always marked for source verification. The original source page, not Openverse, is the rights evidence.

### Wikimedia Commons

Files with explicit open licenses can be delivered when the file-level conditions are followed. Attribution, ShareAlike and third-party rights remain the user's responsibility.

### Stockfilm

The x402 search and rights endpoints are public. Results include the x402 license URL and price. The autonomous purchase route is intentionally not wired into this MVP until Stockfilm confirms who is named licensee when an agent pays for an identified customer.

## Evidence bundle planned for the payment phase

- Provider and asset ID
- Original source URL
- Provider license URL and terms version/date
- Customer/licensee identity
- Provider receipt/license ID
- Payment transaction hash
- Exact permitted/prohibited use
- Attribution text
- Download URL expiry and asset SHA-256

The evidence bundle is proof of the provider transaction; it is not a new license issued by License Hunter.
