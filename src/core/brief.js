// Matched on word boundaries, never as substrings. Plain `includes` made "ad" fire
// inside sad, shadow, radio, adventure, loading and gradient, which flipped ordinary
// personal searches to commercial and narrowed the provider query to pro-licensed
// catalogue only.
const COMMERCIAL_WORDS = [
  "ad",
  "ads",
  "advert",
  "adverts",
  "advertising",
  "brand",
  "branding",
  "business",
  "client",
  "commercial",
  "commercially",
  "company",
  "marketing",
  "monetised",
  "monetized",
  "paid campaign",
  "product",
  "promo",
  "promotional",
  "sponsored",
];

const BROADCAST_WORDS = ["broadcast", "film", "radio", "television", "tv"];

const COMMERCIAL_PATTERN = buildWordPattern(COMMERCIAL_WORDS);
const BROADCAST_PATTERN = buildWordPattern(BROADCAST_WORDS);

// Escapes regex metacharacters and joins terms into a single word-boundary alternation.
// Multi-word terms such as "paid campaign" keep their internal spacing.
function buildWordPattern(words) {
  const escaped = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

export function normalizeBriefLocally(input = {}) {
  input = asObject(input);
  const query = String(input.query || "").trim();
  const lower = `${query} ${input.intendedUse || ""}`.toLowerCase();
  const broadcast = input.broadcast === true || BROADCAST_PATTERN.test(lower);
  // Broadcast implies commercial, matching how the AI path derives `commercial` from
  // usage_rights. Without this the two paths disagreed on the same request.
  const commercial = input.commercial === true || broadcast || COMMERCIAL_PATTERN.test(lower);

  return {
    query,
    originalQuery: query,
    sourceLanguage: inferLikelyLanguage(lower),
    translated: false,
    assetType: input.assetType || inferAssetType(lower),
    intendedUse:
      input.intendedUse || intendedUseFor({ commercial, broadcast }),
    commercial,
    broadcast,
    rawAssetRequired: input.rawAssetRequired !== false,
    territory: input.territory || "worldwide",
    budgetUsd:
      input.budgetUsd === "" || input.budgetUsd == null
        ? null
        : Number(input.budgetUsd),
    keywords: extractLocalKeywords(query),
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Mirrors usageRightsToIntendedUse in the OpenRouter path so both parsers label a
// request the same way.
function intendedUseFor({ commercial, broadcast }) {
  if (broadcast) return "broadcast_content";
  if (commercial) return "commercial_content";
  return "personal_content";
}

// Word-boundary terms, written in scripts that use spacing. Matching these as bare
// substrings routed "window photo", "brain diagram picture" and "stone wall photo" to
// sound effects, because they contain wind, rain and tone.
const SFX_WORDS = [
  "sound effect", "sound effects", "sound fx", "sfx", "foley", "ambience", "ambient",
  "room tone", "roomtone", "click", "ping", "boom", "whoosh", "riser", "creak", "rain",
  "waves", "bird", "birds", "thunder", "hum", "laser", "impact", "subway", "crowd",
  "noise", "buzz", "door", "sparkle", "tick", "rustle", "wind", "chirp", "beep",
  "alert", "tone", "sound", "sounds", "efecto de sonido", "sonido", "ambiente",
  "som ambiente", "efeito sonoro", "effetto sonoro", "suono", "ambiance", "bruitage",
  "effet sonore", "geräusch", "soundeffekt", "sauti", "ariwo", "ohun", "ụda", "ụzụ",
  "sautin", "kararrawa", "kpokpo", "gbam", "gbim", "make sound", "sound wey",
  "звук", "звуковой", "ses efekti", "ambiyansı",
];

const IMAGE_WORDS = [
  "photo", "photos", "photograph", "image", "images", "illustration", "picture",
  "pictures", "poster", "cover", "thumbnail", "hero image", "artwork", "foto",
  "fotos", "fotografia", "fotografía", "imagen", "imagem", "immagine", "bild",
  "visual", "görsel", "resim", "picha", "aworan", "àwòrán", "onyonyo", "hoton",
  "hoto", "изображение", "фото",
];

const MUSIC_WORDS = [
  "music", "song", "songs", "track", "instrumental", "score", "soundtrack", "lofi",
  "lo-fi", "background music", "ambient music", "melody", "anthem", "jingle",
  "música", "musica", "musique", "musik", "canzone", "brano", "muziki", "orin",
  "orín", "egwu", "wakar", "waƙa", "waka", "beat", "song wey", "музыка", "песня",
  "müzik", "şarkı",
];

// Scripts without spacing between words. These stay substring matches by necessity —
// word boundaries are not meaningful in CJK, Arabic or Devanagari.
const SFX_SCRIPT_PATTERN = /(مؤثر صوتي|صوت|साउंड इफेक्ट|ध्वनि|音效|サウンドエフェクト|소리|사운드)/u;
const IMAGE_SCRIPT_PATTERN = /(صورة|صوره|तस्वीर|छवि|画像|写真|이미지|사진|图片|照片|圖像)/u;
const MUSIC_SCRIPT_PATTERN = /(موسيقى|أغنية|संगीत|गाना|音楽|曲|음악|노래|音乐|歌曲)/u;

const SFX_PATTERN = buildWordPattern(SFX_WORDS);
const IMAGE_PATTERN = buildWordPattern(IMAGE_WORDS);
const MUSIC_PATTERN = buildWordPattern(MUSIC_WORDS);

// Image and music are checked before sound effects: "soundtrack" and "sound design for
// my photo" name a primary medium, and the sfx list is the broadest of the three.
function inferAssetType(text) {
  if (IMAGE_PATTERN.test(text) || IMAGE_SCRIPT_PATTERN.test(text)) return "image";
  if (MUSIC_PATTERN.test(text) || MUSIC_SCRIPT_PATTERN.test(text)) return "music";
  if (SFX_PATTERN.test(text) || SFX_SCRIPT_PATTERN.test(text)) return "sound_effect";
  return "music";
}

function extractLocalKeywords(query) {
  return Array.from(new Set(String(query || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []))
    .filter((word) => word.length > 1)
    .slice(0, 12);
}

function inferLikelyLanguage(text) {
  if (/[\u0600-\u06ff]/.test(text)) return "Arabic";
  if (/[\u3040-\u30ff]/.test(text)) return "Japanese";
  if (/[\uac00-\ud7af]/.test(text)) return "Korean";
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  if (/[\u0900-\u097f]/.test(text)) return "Hindi";
  if (/(yoruba|mo nilo|orin|ohun|aworan|àwòrán|fẹ́|ṣe)/iu.test(text)) return "Yoruba";
  if (/(igbo|achọrọ|egwu|onyonyo|ụda|ụzụ)/iu.test(text)) return "Igbo";
  if (/(hausa|ina bukata|wakar|waƙa|hoton|sautin)/iu.test(text)) return "Hausa";
  if (/(abeg|make you|wey|naija|pidgin)/iu.test(text)) return "Nigerian Pidgin";
  return "Unknown";
}
