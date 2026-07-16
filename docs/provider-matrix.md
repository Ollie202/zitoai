# Complete provider matrix

| Provider | Current adapter | Access now | Best use | Main blocker |
|---|---|---|---|---|
| Wikimedia Commons | Live | Public API | Open media with attribution | File-level rights and third-party rights |
| Openverse | Live | Public API | Broad open-media discovery | Original source must be verified |
| Free To Use | Live | Public API | Music discovery and checkout handoff | Non-transferable license |
| Stockfilm | Live | Public x402 discovery/rights | Vintage archival footage | Confirm named end-customer licensee before autonomous delivery |
| Internet Archive | Live | Public API | Supplemental archival discovery | No blanket reuse permission; missing license is reject |
| Adobe Stock | Credential-aware search | Apply/Enterprise/Affiliate/OAuth | Customer-authorized stock licensing | Approval and account/licensee model |
| MotionElements | Catalog only | API key/account | Pay-per-item client procurement | Confirm free production API access |
| Shutterstock | Credential-aware image search | Free test account / paid multimedia plans | In-app platform licensing | Free tier image-only; raw standalone delivery restricted |
| Freesound | Credential-aware search | API key; commercial approval | Sound effects | Commercial API terms negotiated case by case |
| Jamendo | Credential-aware search | Developer key; commercial approval | Music | Commercial API requires agreement |
| Epidemic Sound | Catalog only | Free prototype; Partner API for launch | In-app music | Production partnership required |
| Soundstripe | Catalog only | Partner/Enterprise | Music and SFX in platforms | Partnership and custom terms |
| Lots of Sounds | Catalog only | Paid API | Sound effects | API subscription cost |
| SoundsFree | No API | Website only | Procedural/browser sound tool | Do not scrape |
| Musickits | No API | Website only | CC BY music | Do not scrape; request official feed |
| Creative Commons chooser | No asset API | Public tool | Help creators choose a license | Not evidence for a specific asset |

## Signup/API checklist

Before coding each gated provider, record:

1. Developer portal URL and account owner.
2. Whether API access itself is free.
3. Whether licensing credits/subscriptions are separate.
4. OAuth scopes or API key permissions.
5. Search, preview, rights, license and download endpoints.
6. Whether the customer can be named as licensee.
7. Whether raw files may be delivered outside the provider UI.
8. Attribution, seat, project, territory and duration restrictions.
9. Rate limits, webhook requirements and sandbox behavior.
10. Provider contact's written answer for any unresolved transfer/resale question.
