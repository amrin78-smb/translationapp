'use strict';

/**
 * Netlify Function: /.netlify/functions/translate
 * Stable build: defines APP_VERSION, uses OpenAI Responses API with text.format (no response_format).
 */

const APP_VERSION = process.env.APP_VERSION || "v5-2025-12-25-appversion+textformat";

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

function normalizeThaiParticles(text, speaker, thaiTone) {
  if (!text) return text;
  const tone = String(thaiTone || "").toLowerCase().includes("polite") ? "polite" : "casual";
  if (tone === "casual") {
    // strip any trailing polite particles in casual mode
    return String(text).replace(/[\s\u200b]+$/g, "").replace(/([.!?。！？…]+)?\s*(ครับ|ค่ะ|คะ)\s*$/u, "").trim();
  }
  // polite mode: enforce correct particle at the end (exactly one)
  const isFemale = String(speaker).toLowerCase() === "female";
  const particle = isFemale ? "ค่ะ" : "ครับ";
  let out = String(text).replace(/[\s\u200b]+$/g, "").replace(/([.!?。！？…]+)?\s*(ครับ|ค่ะ|คะ)\s*$/u, "").trim();
  if (out) out = out + " " + particle;
  return out.trim();
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed", _meta: { version: APP_VERSION } }, { allow: "POST" });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body", _meta: { version: APP_VERSION } });
    }

    const text = safeString(body.text).trim();
    const sourceLang = safeString(body.sourceLang) || "auto";
    const targetLang = safeString(body.targetLang) || "Thai";
    const speaker = (safeString(body.speaker) || "male").toLowerCase() === "female" ? "female" : "male";
    const thaiTone = safeString(body.thaiTone || body.tone) || "Casual friendly";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "OPENAI_API_KEY is not set in Netlify environment variables", _meta: { version: APP_VERSION } });
    }
    if (!text) {
      return json(400, { error: "Missing 'text'", _meta: { version: APP_VERSION } });
    }

    const system = [
      "You are a professional translation engine.",
      "Return ONLY valid JSON. No markdown. No code fences. No extra text.",
      "JSON keys must be exactly: source_lang, target_lang, translation, phonetic, notes, detected_source.",
      "",
      "Thai style:",
      "- Make Thai natural everyday spoken Thai.",
      `- Thai tone: ${thaiTone}.`,
      `- Speaker: ${speaker}.`,
      "- If Thai tone is 'Casual friendly': do NOT include polite particles (ครับ/ค่ะ) in the translation.",
      "- If Thai tone is 'More polite': end with exactly one polite particle: male=ครับ, female=ค่ะ.",
      "",
      "Notes:",
      "- Notes must be in English only.",
    ].join("\n");

    const user = [
      `Source language: ${sourceLang}`,
      `Target language: ${targetLang}`,
      `Text: ${text}`,
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // IMPORTANT: Responses API uses text.format (NOT response_format)
        text: { format: { type: "json" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return json(500, { error: "OpenAI API error", details: t.slice(0, 2000), _meta: { version: APP_VERSION } });
    }

    const data = await resp.json();
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

    const translationRaw = safeString(obj.translation);
    const phoneticRaw = safeString(obj.phonetic);
    const notesRaw = safeString(obj.notes);
    const detectedSource = safeString(obj.detected_source) || (sourceLang === "auto" ? "auto" : sourceLang);

    const isThaiTarget = /thai/i.test(targetLang) || safeString(obj.target_lang).toLowerCase() === "thai";
    const translation = isThaiTarget ? normalizeThaiParticles(translationRaw, speaker, thaiTone) : translationRaw;

    return json(200, {
      source_lang: safeString(obj.source_lang) || (sourceLang === "auto" ? "Auto" : sourceLang),
      target_lang: safeString(obj.target_lang) || targetLang,
      translation,
      phonetic: phoneticRaw,
      notes: notesRaw,
      detected_source: detectedSource,
      _meta: { version: APP_VERSION },
    });
  } catch (err) {
    return json(500, { error: "Function crashed", details: String(err?.message || err), _meta: { version: APP_VERSION } });
  }
};
