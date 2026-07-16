# Provider routing strategy

License Hunter does not send every request blindly to every provider. It first ranks providers using deterministic signals, then queries the ranked providers concurrently so a failed or empty catalog can still fall back to another source.

## Ranking inputs

- Asset type: music, sound effect, image or video.
- Intended use: personal, commercial, broadcast or digital product.
- Whether the customer needs the raw file.
- Budget: free/open requests favor open catalogs; a paid budget allows paid agent-native sources.
- Query signals: words such as `archival`, `vintage`, `public domain`, `instrumental`, `commercial`, `background music`, and `creative commons`.

## Current routing decisions

### Vintage or archival video

Stockfilm is ranked first because it has a specialized vintage archive, a rights endpoint and an agent-native payment path. Wikimedia remains a fallback for public-domain or Creative Commons footage.

### Free/open media

Wikimedia Commons is ranked first for explicit public-domain/Creative Commons requests. Openverse follows as a broad discovery layer, but every result still requires checking the original source.

### Music

Free To Use is ranked for music searches, especially personal/social background music. For commercial use it is intentionally marked `checkout_only`, because its license is non-transferable. Openverse and Wikimedia are alternatives for openly licensed music.

### Commercial raw-file procurement

The router does not override a provider's legal policy. A high relevance score cannot turn a non-transferable or platform-only license into an allowed delivery. The policy engine runs after provider ranking and can downgrade or reject the result.

## OpenRouter's role

When the OpenRouter key is added, it improves:

- Intent extraction from natural language.
- Asset-type detection.
- Search-term expansion and synonym generation.
- Ranking explanations.
- Asking for missing information such as territory or commercial use.

It must not replace the deterministic provider policy engine. The model may suggest a provider; only the provider profile and license rules can determine whether that route is allowed.
