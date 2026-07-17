# ZitoAI provider docs

ZitoAI now works with three live licensing APIs:

1. Shutterstock for image licensing.
2. Freesound for sound effects, ambience and one-shots.
3. Jamendo for songs and music tracks.

## Request lifecycle

1. The user describes the asset and intended use.
2. The brief parser normalizes the request.
3. Provider connectors search the three active providers only.
4. The policy layer screens usage and license constraints.
5. Results are marked `allowed`, `review`, `checkout_only` or `rejected`.
6. Paid purchasing is deliberately gated behind user confirmation and provider-specific evidence.

## Run it

```powershell
Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>.

## API surface

### `GET /api/health`

Returns service version, brain config, storage config and OAuth config.

### `GET /api/providers`

Returns the three live provider definitions and whether each is configured.

### `POST /api/brief`

Normalizes a user request.

### `POST /api/search`

Runs the three live providers concurrently and applies policy checks.

## Important policy decisions

### Shutterstock

Use for image licensing only. Licensing requires the configured access token and the correct license scopes.

### Freesound

Use for sound effects and ambience. Keep file-level license terms attached to the evidence.

### Jamendo

Use for music tracks. Track-level commercial rights and attribution still need verification.

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

The evidence bundle is proof of the provider transaction; it is not a new license issued by ZitoAI.
