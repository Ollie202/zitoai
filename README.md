# License Hunter

An OKX.AI-ready, license-aware asset procurement agent.

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

Search, rights screening and provider routing are live. Paid purchase execution is deliberately separated until the customer/licensee model is confirmed per provider. The next implementation phase is authenticated provider adapters, customer checkout/OAuth, OKX Agent Payments Protocol payment confirmation, and the License Evidence Pack.
