# Complete provider matrix

| Provider | Current adapter | Access now | Best use | Main blocker |
|---|---|---|---|---|
| Shutterstock | Credential-aware image licensing | OAuth app + API subscription | Image licensing | Requires the correct OAuth scopes and a valid image license path |
| Freesound | Credential-aware search | API key / client credentials | Sound effects, ambience, one-shots | Commercial API approval and file-level CC terms |
| Jamendo | Credential-aware search | Developer client ID | Songs and music tracks | Commercial API agreement |

## Current policy

The app no longer routes search traffic to Adobe, MotionElements, Stockfilm, Soundstripe, Epidemic Sound, Lots of Sounds, SoundsFree, Musickits, Openverse, Wikimedia Commons or Internet Archive.

## Integration order

1. Search the active provider for the requested asset type.
2. Preserve preview URL, source URL and license metadata.
3. Require user confirmation before any licensing action.
4. Record the transaction evidence in Supabase.
