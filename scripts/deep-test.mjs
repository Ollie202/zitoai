// Deep functional test: 30 real prompts (10 music / 10 image / 10 sound effect) across
// different languages, each sent directly to the free A2MCP endpoint.
//
//   node scripts/deep-test.mjs [base-url]

const base = (process.argv[2] || "https://asp.zitoai.xyz").replace(/\/+$/, "");
const endpoint = `${base}/api/a2mcp/media-search`;
const timeoutMs = Number(process.env.A2MCP_SMOKE_TIMEOUT_MS || 50_000);

async function directCall(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": `deep-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    const json = await response.json().catch(() => ({}));
    return {
      status: response.status,
      json,
      durationMs,
      paymentRequired: response.headers.has("payment-required"),
      requestId: response.headers.get("x-request-id"),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 30 prompts: 10 per media type, spread across languages and phrasings a real
// caller might use — including a couple of deliberately hard/ambiguous ones.
// ---------------------------------------------------------------------------
const CASES = [
  // music (10) — English, Yoruba, Chinese, Hausa, Spanish, French, Arabic, Igbo, Pidgin, Hindi
  { type: "music", lang: "en", query: "upbeat music for a 30 second product launch video", assetType: "music" },
  { type: "music", lang: "yo", query: "mo nilo orin ayeye ojo ibi", assetType: "music" },
  { type: "music", lang: "zh", query: "我需要生日快乐的音乐", assetType: "music" },
  { type: "music", lang: "ha", query: "ina bukatar wakar bikin haihuwa", assetType: "music" },
  { type: "music", lang: "es", query: "musica relajante para meditacion y yoga", assetType: "music" },
  { type: "music", lang: "fr", query: "musique epique pour bande annonce de film d'action", assetType: "music" },
  { type: "music", lang: "ar", query: "موسيقى حزينة للفيديوهات العاطفية", assetType: "music" },
  { type: "music", lang: "ig", query: "achọrọ m egwu maka ememme obodo", assetType: "music" },
  { type: "music", lang: "pcm", query: "I wan energetic music for gym video", assetType: "music" },
  { type: "music", lang: "hi", query: "शादी समारोह के लिए खुशी वाला संगीत चाहिए", assetType: "music" },

  // image (10) — English, Chinese, Spanish, Yoruba, French, Arabic, Portuguese, Hausa, German, Pidgin
  { type: "image", lang: "en", query: "a photo of a window at sunset", assetType: "image" },
  { type: "image", lang: "zh", query: "现代办公室里团队合作的照片", assetType: "image" },
  { type: "image", lang: "es", query: "una foto de una ciudad futurista de noche", assetType: "image" },
  { type: "image", lang: "yo", query: "mo fe aworan oko ajeseku ni orile-ede Naijiria", assetType: "image" },
  { type: "image", lang: "fr", query: "photo d'une famille heureuse en train de cuisiner", assetType: "image" },
  { type: "image", lang: "ar", query: "صورة لشخص يمارس رياضة الجري في الصباح", assetType: "image" },
  { type: "image", lang: "pt", query: "foto de uma praia tropical com palmeiras", assetType: "image" },
  { type: "image", lang: "ha", query: "ina bukatar hoton kasuwa a Najeriya", assetType: "image" },
  { type: "image", lang: "de", query: "ein Foto von einem modernen Buero mit Laptops", assetType: "image" },
  { type: "image", lang: "pcm", query: "I need picture of Lagos traffic for blog post", assetType: "image" },

  // sound effect / ambience (10) — English, Chinese, Spanish, Yoruba, French, Arabic, Hausa, Igbo, Pidgin, Hindi
  { type: "sound_effect", lang: "en", query: "rain ambience for meditation", assetType: "sound_effect" },
  { type: "sound_effect", lang: "zh", query: "打雷的音效用于恐怖电影", assetType: "sound_effect" },
  { type: "sound_effect", lang: "es", query: "sonido de olas del mar para relajacion", assetType: "sound_effect" },
  { type: "sound_effect", lang: "yo", query: "mo fe ohun ategun fun ise agbese fiimu", assetType: "sound_effect" },
  { type: "sound_effect", lang: "fr", query: "bruit de foule applaudissant dans un stade", assetType: "sound_effect" },
  { type: "sound_effect", lang: "ar", query: "صوت انفجار للألعاب", assetType: "sound_effect" },
  { type: "sound_effect", lang: "ha", query: "ina bukatar sautin tsuntsaye da safe", assetType: "sound_effect" },
  { type: "sound_effect", lang: "ig", query: "achọrọ m ụda mmiri na-asọ maka ihe nkiri", assetType: "sound_effect" },
  { type: "sound_effect", lang: "pcm", query: "I need sound wey be like glass wey break", assetType: "sound_effect" },
  { type: "sound_effect", lang: "hi", query: "जंगल में पक्षियों की आवाज़ चाहिए", assetType: "sound_effect" },
];

console.log(`Deep test: ${CASES.length} prompts against ${endpoint}\n`);

const results = [];
let index = 0;
for (const testCase of CASES) {
  index += 1;
  const label = `[${String(index).padStart(2, "0")}/${CASES.length}] ${testCase.type.padEnd(13)} ${testCase.lang.padEnd(4)}`;
  try {
    const { status, json, durationMs, paymentRequired, requestId } = await directCall({
      query: testCase.query,
      assetType: testCase.assetType,
      intendedUse: "commercial_content",
      territory: "worldwide",
      limit: 5,
    });

    const ok = status === 200 && !paymentRequired;
    const result = json?.result || {};
    const candidates = result.results || [];
    const count = typeof result.count === "number" ? result.count : candidates.length;
    const matchQuality = result.matchQuality?.quality || "?";
    const detectedType = result.brief?.assetType || "?";
    const sourceLanguage = result.processing?.sourceLanguage || "?";
    const degraded = Boolean(result.processing?.degraded);
    const provider = count > 0 ? (candidates[0].provider || "?") : "-";

    console.log(
      `${label}  ${ok ? "OK  " : "FAIL"}  ${status}  ${String(durationMs).padStart(5)}ms  results=${count}  type=${detectedType}  lang=${sourceLanguage}  quality=${String(matchQuality).slice(0, 30)}  provider=${provider}${degraded ? "  [degraded]" : ""}  request=${requestId || "-"}`,
    );
    if (!ok) {
      console.log(
        `         error: ${paymentRequired ? "unexpected payment challenge" : json?.error || "?"} — ${json?.message || JSON.stringify(json).slice(0, 200)}`,
      );
    }

    results.push({ ...testCase, ok, status, durationMs, count, detectedType, sourceLanguage, matchQuality, provider, degraded, paymentRequired, requestId });
  } catch (error) {
    console.log(`${label}  FAIL  threw: ${error.message}`);
    results.push({ ...testCase, ok: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
console.log("\n--- Summary by media type ---");
for (const type of ["music", "image", "sound_effect"]) {
  const rows = results.filter((r) => r.type === type);
  const passed = rows.filter((r) => r.ok).length;
  const zeroResult = rows.filter((r) => r.ok && r.count === 0).length;
  const avgMs = Math.round(rows.filter((r) => r.durationMs).reduce((sum, r) => sum + r.durationMs, 0) / (rows.filter((r) => r.durationMs).length || 1));
  console.log(`${type.padEnd(14)} ${passed}/${rows.length} served, ${zeroResult} returned zero results, avg ${avgMs}ms`);
}

const failed = results.filter((r) => !r.ok);
const zero = results.filter((r) => r.ok && r.count === 0);
console.log(`\nTotal: ${results.length}, served ${results.length - failed.length}, failed ${failed.length}, zero-result ${zero.length}`);
if (failed.length) {
  console.log("\nFailed cases:");
  for (const r of failed) console.log(`  - [${r.type}/${r.lang}] "${r.query}" — ${r.error || `${r.status}`}`);
}
if (zero.length) {
  console.log("\nZero-result cases:");
  for (const r of zero) console.log(`  - [${r.type}/${r.lang}] "${r.query}"`);
}

process.exit(failed.length ? 1 : 0);
