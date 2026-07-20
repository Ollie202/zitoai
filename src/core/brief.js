const COMMERCIAL_WORDS = [
  "ad",
  "advert",
  "brand",
  "business",
  "client",
  "commercial",
  "company",
  "marketing",
  "monetized",
  "paid campaign",
  "product",
  "sponsored",
];

const BROADCAST_WORDS = ["broadcast", "film", "radio", "television", "tv"];

export function normalizeBriefLocally(input = {}) {
  input = asObject(input);
  const query = String(input.query || "").trim();
  const lower = `${query} ${input.intendedUse || ""}`.toLowerCase();
  const commercial =
    input.commercial === true || COMMERCIAL_WORDS.some((word) => lower.includes(word));
  const broadcast = BROADCAST_WORDS.some((word) => lower.includes(word));

  return {
    query,
    originalQuery: query,
    sourceLanguage: inferLikelyLanguage(lower),
    translated: false,
    assetType: input.assetType || inferAssetType(lower),
    intendedUse:
      input.intendedUse || (commercial ? "commercial_content" : "personal_content"),
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

function inferAssetType(text) {
  if (/(sound effect|sound effects|sfx|foley|ambience|ambient|room tone|roomtone|click|ping|boom|whoosh|riser|creak|rain|waves|bird|birds|thunder|hum|laser|impact|subway|crowd|noise|buzz|door|pop|sparkle|tick|rustle|wind|chirp|beep|alert|tone|efecto de sonido|sonido|ambiente|som ambiente|som|efeito sonoro|effetto sonoro|suono|ambiance|bruitage|effet sonore|geräusch|soundeffekt|مؤثر صوتي|صوت|साउंड इफेक्ट|ध्वनि|音效|サウンドエフェクト|소리|사운드|sauti|ohun|звук|звуковой|ses efekti|ses|ambiyansı|ohun|ariwo|sauti|ụda|ụzụ|sauti|sautin|kararrawa|amo|kpokpo|gbam|gbim|make sound|sound wey)/iu.test(text)) return "sound_effect";
  if (/(photo|image|illustration|picture|poster|cover|thumbnail|hero image|foto|fotografia|fotografía|imagen|imagem|immagine|bild|visual|görsel|resim|صورة|صوره|तस्वीर|छवि|画像|写真|이미지|사진|图片|照片|圖像|picha|aworan|àwòrán|foto|onyonyo|hoton|hoto|picha|изображение|фото)/iu.test(text)) return "image";
  if (/(music|song|track|instrumental|score|soundtrack|lofi|background music|ambient music|melody|música|musica|musique|musik|canzone|brano|موسيقى|أغنية|संगीत|गाना|音楽|曲|음악|노래|音乐|歌曲|muziki|orin|orín|egwu|wakar|waƙa|waka|beat|song wey|музыка|песня|müzik|şarkı)/iu.test(text)) return "music";
  if (/(footage|video|clip|motion|reel|animation|b-roll)/.test(text)) return "music";
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
