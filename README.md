# ZitoAI

An OKX.AI-ready, rights-aware media procurement and evidence agent.

## Start

```powershell
npm test
npm start
```

Open `http://localhost:3000`.

No API keys are required for the five live public connectors: Wikimedia Commons, Openverse, Free To Use, Stockfilm public x402 discovery/rights, and Internet Archive.

## Read first

- [End-to-end architecture](docs/ARCHITECTURE.md)
- [Complete provider matrix](docs/provider-matrix.md)
- [Provider routing strategy](docs/provider-routing.md)
- [Provider onboarding/status](docs/providers/signup-required.md)
- [Operational documentation](docs/README.md)

## Current boundary

Search, rights screening, provider routing, OAuth foundations, authenticated evidence storage, and PDF/JSON License Evidence Packs are implemented. Paid purchase execution remains deliberately separated until the customer/licensee model is confirmed per provider; ZitoAI never represents a payment or license as completed without provider evidence and explicit user confirmation.

## Production endpoints

- App: <https://www.zitoai.xyz>
- Health: <https://www.zitoai.xyz/api/health>
- Agent card: <https://www.zitoai.xyz/.well-known/agent-card.json>
- Rights-aware agent search: `POST /api/agent/search`
- Evidence Pack: `POST /api/evidence-pack?format=pdf`

See [OAuth setup](docs/OAUTH.md) and [Supabase setup](supabase/README.md) before enabling private history or account-connected providers.
