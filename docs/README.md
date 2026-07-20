# ZitoAI docs

This folder contains the production documentation for the current ZitoAI build.

## Core documents

| Document | Purpose |
|---|---|
| [Architecture](ARCHITECTURE.md) | System boundary, runtime flow, provider responsibilities and security model |
| [API keys](API-KEYS.md) | Where to get credentials and which variables are required |
| [Provider matrix](provider-matrix.md) | Current provider coverage and limitations |
| [Provider routing](provider-routing.md) | How requests are routed to Shutterstock, Freesound and Jamendo |
| [Credential-aware adapters](gated-adapters.md) | Provider-specific adapter behavior |
| [OAuth setup](OAUTH.md) | OAuth callback and account connection notes |
| [Operational status](zitoai-status.md) | Build status, testing notes and remaining operational tasks |

## Current production shape

ZitoAI exposes one free A2MCP API service:

```text
POST https://asp.zitoai.xyz/api/a2mcp/media-search
```

The service routes to:

- Shutterstock for images
- Freesound for sound effects and ambience
- Jamendo for music tracks

The docs should stay aligned with that three-provider production boundary unless the code is intentionally expanded.
