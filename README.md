# ZitoAI

ZitoAI is a production-oriented OKX.AI ASP and A2MCP service for rights-aware media search.

It helps users find licensable images, sound effects, music tracks, and ambience. The service accepts a natural language media brief, chooses the right provider, filters results by media type and usage fit, and returns strong matches with licensing metadata and the next licensing step.

## Live endpoints

| Surface | URL |
|---|---|
| Website | https://www.zitoai.xyz |
| ASP base | https://asp.zitoai.xyz |
| Health check | https://asp.zitoai.xyz/api/health |
| A2MCP manifest | https://asp.zitoai.xyz/.well-known/a2mcp.json |
| A2MCP media search | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |

## Active providers

| Media type | Provider | Purpose |
|---|---|---|
| Images | Shutterstock | Image search, metadata, licensing endpoint support when the account token has the correct scopes and entitlement |
| Sound effects and ambience | Freesound | Sound search, previews, metadata, license capture, and OAuth-backed original download where authorized |
| Music tracks | Jamendo | Track search, previews, metadata, and commercial licensing handoff evidence |

ZitoAI does not route production search traffic to earlier prototype or research providers. The production boundary is intentionally limited to Shutterstock, Freesound, and Jamendo.

## A2MCP service

The current public OKX.AI listing mode is free.

```text
Service name: Rights Media Search
Service type: API service
Fee: 0 USDT
Endpoint: https://asp.zitoai.xyz/api/a2mcp/media-search
```

Example request:

```bash
curl -X POST https://asp.zitoai.xyz/api/a2mcp/media-search \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"upbeat music for a 30 second product launch video\",\"assetType\":\"music\",\"intendedUse\":\"commercial_content\",\"territory\":\"worldwide\",\"limit\":5}"
```

## Local development

Requirements:

- Node.js 20 or newer
- Provider credentials in `local.env` or `.env`

Install and run:

```powershell
npm install
npm test
npm start
```

Open `http://localhost:3000`.

The app loads `local.env` first, then `.env`, then process environment variables. Do not commit real secrets.

## Environment setup

Start from the template:

```powershell
Copy-Item .env.example local.env
```

Minimum useful production variables:

- `PUBLIC_BASE_URL`
- `ASP_BASE_URL`
- `OPENROUTER_API_KEY`
- `SHUTTERSTOCK_ACCESS_TOKEN`
- `FREESOUND_API_KEY`
- `JAMENDO_CLIENT_ID`
- Supabase variables if private history and evidence storage are enabled

See [API key setup](docs/API-KEYS.md) for exact provider links and scopes.

## Project structure

```text
public/                 Static website, browser UI, legal pages, logo assets
src/
  core/                 Brief parsing, routing, policy logic
  lib/                  Shared HTTP helpers
  providers/            Provider catalog and search adapters
  services/             API services, OAuth, evidence, Supabase, A2MCP
test/                   Node test suite
docs/                   Production docs and operating notes
supabase/               Database migration for evidence and procurement records
```

## Production safety rules

- Provider API keys stay server-side.
- Browser code never receives provider secrets or wallet credentials.
- ZitoAI does not invent licenses, receipts, or legal clearance.
- Provider terms control the actual rights.
- Evidence Packs record proof supplied by provider APIs, receipts, and user supplied checkout evidence. They do not create new rights.
- Paid provider purchases remain separate from the free A2MCP call and must be backed by provider evidence.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API keys and callbacks](docs/API-KEYS.md)
- [Provider matrix](docs/provider-matrix.md)
- [Provider routing](docs/provider-routing.md)
- [Credential-aware adapters](docs/gated-adapters.md)
- [Operational status](docs/zitoai-status.md)
