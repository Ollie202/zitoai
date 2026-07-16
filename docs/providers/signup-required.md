# Providers that require signup, approval or provider credentials

These are deliberately not wired into the public MVP yet:

| Provider | What is needed | Planned integration |
|---|---|---|
| Adobe Stock | Enterprise, Affiliate or approved API access; customer OAuth or approved service-account workflow | Customer-authorized licensing only |
| MotionElements | API secret key; public docs do not promise free production API access | Pay-per-item client-licensee flow; confirm API pricing first |
| Shutterstock | Free image test account; paid API/partner plan for video and music | Not suitable for raw-file delivery through Platform License |
| Freesound | API credentials; commercial API use negotiated case by case | Only after written commercial approval |
| Jamendo | Developer registration/API key; commercial API use requires sales approval | Only after commercial API agreement |
| Epidemic Sound | Free prototype key; production Partner API arrangement | Provider partnership required |
| Soundstripe | Partner/Enterprise API agreement | Provider partnership required |

For each provider, collect the API key through the provider's official developer portal. Store it only in `.env` or a secret manager, never in browser code, source control or result metadata.
