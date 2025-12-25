exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON request body" }) };
  }

  const { action, text, sourceLang, targetLang, options, translation } = payload;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "x-app-version": "v9-working-base-thai-particle-postprocess",
  };

  const stripCodeFences = (s) => {
    if (!s || typeof s !== "string") return "";
    // Remove ```json ... ``` or ``` ... ``` wrappers
    const fenced = s.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
    return fenced ? fenced[1] : s.trim();
  };

  const callChatCompletions = async (systemPrompt, userContent, temperature = 0.2) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    "x-app-version": "v9-working-base-thai-particle-postprocess",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent || "" },
        ],
        temperature,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `OpenAI request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  };

  try {
    if (action === "explain") {
      if (!text || !translation) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing text or translation for explanation" }) };
      }

      const explainPrompt = `You are a language teacher.
Explain the translation in plain English.
Rules:
- NO markdown
- NO bullet characters like • unless necessary
- Keep it structured with short paragraphs
- Include: meaning, tone, and 1-2 alternative phrasings (if relevant)

Source: ${text}
Target: ${translation}`;

      const data = await callChatCompletions(explainPrompt, "Explain.", 0.3);
      const explanation = (data.choices?.[0]?.message?.content || "").trim();
      return { statusCode: 200, headers, body: JSON.stringify({ explanation }) };
    }

    if (!text || !targetLang) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing text or targetLang" }) };
    }

    const src = sourceLang || "auto";
    const tgt = targetLang;

    // Options are passed through (tone, gender, script toggles) but the prompt remains robust even if options are missing.
    const opts = options || {};
    // Also accept top-level fields for compatibility
    if (!opts.speaker && payload.speaker) opts.speaker = payload.speaker;
    if (!opts.gender && payload.gender) opts.gender = payload.gender;
    if (!opts.thaiTone && payload.thaiTone) opts.thaiTone = payload.thaiTone;
    if (!opts.thai_tone && payload.thai_tone) opts.thai_tone = payload.thai_tone;
    if (!opts.tone && payload.tone) opts.tone = payload.tone;

    const thaiTone = opts.thaiTone || opts.thai_tone || "Casual friendly";
    const speaker = opts.speaker || opts.gender || "Male";

const speakerRaw = String(speaker || "").trim();
const speakerLower = speakerRaw.toLowerCase();
const speakerNorm =
  speakerLower.startsWith("f") || speakerLower === "woman" || speakerLower === "female"
    ? "Female"
    : "Male";

// Thai polite particle derived from speaker selection (only used when Thai tone = "More polite")
const politeParticle = speakerNorm === "Female" ? "ค่ะ" : "ครับ";
const politeParticlePhonetic = speakerNorm === "Female" ? "khâ" : "khráp";
    const cnScript = opts.chineseScript || opts.chinese_script; // Simplified/Traditional
    const jpStyle = opts.japaneseStyle || opts.japanese_style;   // Polite/Casual
    const krStyle = opts.koreanStyle || opts.korean_style;       // Formal/Casual

    const systemPrompt = `You are a professional human translator.

Translate from ${src} to ${tgt}.

Critical rules:
- Output MUST be valid JSON only. No code fences. No extra text.
- If the input is 1–3 words, behave like a bilingual dictionary.
- Prefer real target-language words over transliteration. Transliterate only when the proper target term is unknown or commonly borrowed.
- If translating Malay/Indonesian food/fruit terms into Thai, use the common Thai term (not phonetic borrowing) when it exists.

Thai style rules (when target is Thai):
- Make the Thai translation sound like natural everyday spoken Thai.
- Thai tone preference: ${thaiTone}. Speaker: ${speakerNorm}.
- If thaiTone is "Casual friendly": DO NOT include polite particles (ครับ/ค่ะ) in the translation.
- If thaiTone is "More polite": end the translation with exactly ONE polite particle at the very end: ${politeParticle}
- Avoid overly formal structures like "เราจะได้...มาอย่างไร" unless the user’s input is clearly formal. Prefer common spoken patterns such as "…ต้องทำยังไง", "…ทำยังไง", "…เอายังไง", "…ยังไงดี" where appropriate.

Phonetic rules:
- If Thai tone is "More polite", ensure the phonetic ends with the matching particle (${politeParticlePhonetic}).
- If target is Thai, provide phonetic in Latin characters WITH tone marks where possible, using Thai-learning-friendly diacritics (e.g., yàak, dâi, an níi, yang-ngai). Keep it readable and consistent.

Other language options:
- For Chinese: use ${cnScript || "default script"} if specified.
- For Japanese style: ${jpStyle || "default"} if specified.
- For Korean style: ${krStyle || "default"} if specified.

Notes rules:
- Notes MUST be in English only.

Required JSON format:
{
  "source_lang": "...",
  "target_lang": "...",
  "translation": "...",
  "phonetic": "...",
  "notes": "..."
}
`;

    const data1 = await callChatCompletions(systemPrompt, text, 0.2);
    let raw = stripCodeFences(data1.choices?.[0]?.message?.content || "");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Retry once with a stricter instruction
      const retryPrompt = systemPrompt + "\n\nIMPORTANT: Return ONLY raw JSON. Do not wrap in ``` fences. Do not add any commentary.";
      const data2 = await callChatCompletions(retryPrompt, text, 0.1);
      raw = stripCodeFences(data2.choices?.[0]?.message?.content || "");
      parsed = JSON.parse(raw); // throws if still invalid
    }

// --- Post-processing to enforce Thai particles deterministically (model may drift) ---
const normalizeTone = (t) => {
  const s = String(t || "").toLowerCase();
  return s.includes("polite") ? "More polite" : "Casual friendly";
};

const stripThaiParticle = (s) => {
  if (!s) return "";
  return String(s)
    .replace(/[\s\u200b]+$/g, "")
    .replace(/([\.!?。！？…]+)?\s*(ครับ|ค่ะ|คะ)\s*$/u, "")
    .trim();
};

const stripPhoneticParticle = (s) => {
  if (!s) return "";
  return String(s)
    .replace(/[\s\u200b]+$/g, "")
    .replace(/([\.!?]+)?\s*(khrab|khrap|khráp|khâ|kha|ka)\s*$/iu, "")
    .trim();
};

const applyThaiPoliteness = (outObj) => {
  const targetIsThai = String(outObj.target_lang || tgt).toLowerCase() === "thai" || String(tgt).toLowerCase() === "thai";
  if (!targetIsThai) return outObj;

  const toneNorm = normalizeTone(thaiTone);
  let translation2 = stripThaiParticle(outObj.translation || "");
  let phonetic2 = stripPhoneticParticle(outObj.phonetic || "");

  if (toneNorm === "More polite") {
    const particle = politeParticle; // derived earlier from speakerNorm
    const particlePh = politeParticlePhonetic;
    if (translation2) translation2 = translation2 + " " + particle;
    if (phonetic2) phonetic2 = phonetic2 + " " + particlePh;
  }
  return { ...outObj, translation: translation2, phonetic: phonetic2 };
};

    // Normalize keys expected by the UI
    let out = {
      source_lang: parsed.source_lang || src,
      target_lang: parsed.target_lang || tgt,
      translation: parsed.translation || "",
      phonetic: parsed.phonetic || "",
      notes: parsed.notes || "",
    };

    out = applyThaiPoliteness(out);

    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
