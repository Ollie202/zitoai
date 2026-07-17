# Provider routing strategy

ZitoAI now routes searches across three live providers only:

- Shutterstock for images
- Freesound for sound effects, ambience and one-shots
- Jamendo for songs and music tracks

## Ranking inputs

- Asset type
- Intended use
- Whether the customer needs the raw file
- Budget
- Query signals such as `image`, `photo`, `music`, `song`, `instrumental`, `sound effect`, `ambient`

## Current routing decisions

### Images

Shutterstock is ranked first for image requests. It is the only active image licensing provider in the build.

### Sound effects

Freesound is ranked first for sound effect, ambience and one-shot requests.

### Music

Jamendo is ranked first for music and song requests.

## OpenRouter's role

When the OpenRouter key is added, it improves:

- Intent extraction from natural language.
- Asset-type detection.
- Search-term expansion and synonym generation.
- Ranking explanations.
- Asking for missing information such as territory or commercial use.

It must not replace the deterministic provider policy engine.
