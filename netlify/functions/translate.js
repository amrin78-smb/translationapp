/**
 * Netlify Function: /.netlify/functions/translate
 * Fix: APP_VERSION ReferenceError (define a safe default)
 *
 * Returns strict JSON and adds x-app-version header so you can verify what version is running.
 */

const APP_VERSION = process.env.APP_VERSION || "v4-2025-12-25-particlefix+versionheader";

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-app-version": APP_VERSION,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function safeString(v) {
  return typeof v === "string" ? v : "";
}

function normalizeThaiParticles(text, speaker) {
  if (!text) return text;
  const isFemale = String(speaker).toLowerCase() === "female";
  let out = text;

  if (isFemale) {
    out = out.replace(/ครับ\s*$/u, "ค่ะ");
  } else {
    out = out.replace(/(ค่ะ|คะ)\s*$/u, "ครับ");
  }
  return out;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed", _meta: { version: APP_VERSION } }, { allow: "POST" });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body", _meta: { version: APP_VERSION } });
    }

    const {
      text = "",
      sourceLang = "auto",
      targetLang = "Thai",
      speaker = "male",
      thaiTone = "casual",
      chineseScript = "simplified",
      japaneseStyle = "polite",
      koreanStyle = "formal",
    } = body;

    if (!text || !String(text).trim()) {
      return json(400, { error: "Missing 'text'", _meta: { version: APP_VERSION } });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "OPENAI_API_KEY is not set in Netlify environment variables", _meta: { version: APP_VERSION } });
    }

    const speakerLabel = String(speaker).toLowerCase() === "female" ? "female" : "male";
    const thaiToneLabel = String(thaiTone).toLowerCase() === "polite" ? "more polite" : "casual friendly";

    const system = [
      "You are a high-accuracy translation engine.",
      "Return ONLY valid JSON, no markdown, no code fences, no extra text.",
      "JSON keys must be exactly: source_lang, target_lang, translation, phonetic, notes, detected_source.",
      "",
      "Style requirements:",
      "- Translate into natural, everyday spoken language for the target.",
      "- For Thai: default is casual-friendly spoken Thai. Do NOT over-formalize.",
      `- Thai tone: ${thaiToneLabel}.`,
      `- Speaker: ${speakerLabel}. If you include a Thai polite particle, use ครับ for male and ค่ะ for female.`,
      "- If input is a single word (e.g., fruit/food), prefer the most common native term in the target language, not a generic transliteration.",
      "",
      "Phonetic requirements:",
      "- Always return phonetic for Thai, Japanese, Korean, Chinese outputs.",
      "- Thai phonetic: simple readable romanization.",
      "",
      "Language toggles (when relevant):",
      `- Chinese script: ${chineseScript} (simplified/traditional).`,
      `- Japanese style: ${japaneseStyle} (polite/casual).`,
      `- Korean style: ${koreanStyle} (formal/casual).`,
      "",
      "Notes requirements:",
      "- Notes must be in English (short, 1-2 sentences).",
    ].join("\n");

    const user = [
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Text: ${text}`,
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return json(500, { error: "OpenAI API error", details: t.slice(0, 2000), _meta: { version: APP_VERSION } });
    }

    const data = await res.json();
    const outputText =
      safeString(data.output_text) ||
      safeString(data?.output?.[0]?.content?.[0]?.text) ||
      "";

    let obj;
    try {
      obj = JSON.parse(outputText);
    } catch {
      return json(500, {
        error: "Model did not return valid JSON",
        details: outputText.slice(0, 2000),
        _meta: { version: APP_VERSION },
      });
    }

    const translationRaw = safeString(obj?.translation);
    const phoneticRaw = safeString(obj?.phonetic);
    const notesRaw = safeString(obj?.notes);
    const detectedSource = safeString(obj?.detected_source) || (sourceLang === "auto" ? "auto" : sourceLang);

    const translation =
      targetLang === "Thai" || /thai/i.test(String(targetLang))
        ? normalizeThaiParticles(translationRaw, speakerLabel)
        : translationRaw;

    return json(200, {
      source_lang: safeString(obj?.source_lang) || (sourceLang === "auto" ? "Auto" : sourceLang),
      target_lang: safeString(obj?.target_lang) || targetLang,
      translation,
      phonetic: phoneticRaw,
      notes: notesRaw,
      detected_source: detectedSource,
      _meta: { version: APP_VERSION },
    });
  } catch (err) {
    return json(500, {
      error: "Function crashed",
      details: String(err?.message || err),
      _meta: { version: APP_VERSION },
    });
  }
};
