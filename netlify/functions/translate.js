'use strict';

/**
 * Netlify Function: /.netlify/functions/translate
 * Stable (no optional chaining, no modern syntax that breaks older runtimes)
 * - Uses Chat Completions API (compatible with your previously working setup)
 * - Removes male/female feature: never appends Thai polite particles
 * - Always strips trailing ครับ/ค่ะ/คะ (and khrab/khâ...) for Thai output
 */

var APP_VERSION = process.env.APP_VERSION || 'v11-no-gender-no-optional-chaining';

function jsonResponse(statusCode, payload, extraHeaders) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'x-app-version': APP_VERSION
  };
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(payload) };
}

function stripThaiParticleAlways(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\s\u200b]+$/g, '')
    .replace(/([\.!?。！？…]+)?\s*(ครับ|ค่ะ|คะ)\s*$/u, '')
    .trim();
}

function stripPhoneticParticleAlways(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\s\u200b]+$/g, '')
    .replace(/([\.!?]+)?\s*(khrab|khrap|khrap|khráp|khâ|kha|ka)\s*$/ig, '')
    .trim();
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return jsonResponse(200, { ok: true, _meta: { version: APP_VERSION } });
    }
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed', _meta: { version: APP_VERSION } }, { Allow: 'POST, OPTIONS' });
    }

    var payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return jsonResponse(400, { error: 'Invalid JSON body', _meta: { version: APP_VERSION } });
    }

    var text = (payload && payload.text != null) ? String(payload.text) : '';
    text = text.trim();

    // Support multiple client schemas
    var src = (payload && (payload.sourceLang || payload.src || payload.source || payload.from)) ? (payload.sourceLang || payload.src || payload.source || payload.from) : 'auto';
    var tgt = (payload && (payload.targetLang || payload.tgt || payload.target || payload.to)) ? (payload.targetLang || payload.tgt || payload.target || payload.to) : 'Thai';

    if (!text) {
      return jsonResponse(400, { error: "Missing 'text'", _meta: { version: APP_VERSION } });
    }

    var apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(500, { error: 'OPENAI_API_KEY is not set in Netlify environment variables', _meta: { version: APP_VERSION } });
    }

    var systemPrompt =
      "You are a professional translation engine.\n" +
      "Return ONLY valid JSON. No markdown. No code fences. No extra text.\n" +
      "JSON keys must be exactly: source_lang, target_lang, translation, phonetic, notes.\n\n" +
      "Rules:\n" +
      "- Translate into natural, everyday spoken language for the target.\n" +
      "- If target is Thai: NEVER add polite particles (ครับ/ค่ะ/คะ). Keep it neutral and friendly.\n" +
      "- If input is a single word (food/fruit/proper noun), use the most common target-language term if it exists.\n" +
      "- Notes must be in English only (short).\n\n" +
      "Phonetic:\n" +
      "- If target is Thai/Japanese/Korean/Chinese, provide phonetic in Latin letters.\n" +
      "- Otherwise phonetic can be empty string if not needed.\n\n" +
      "Output JSON example:\n" +
      "{\n" +
      "  \"source_lang\": \"Malay\",\n" +
      "  \"target_lang\": \"Thai\",\n" +
      "  \"translation\": \"...\",\n" +
      "  \"phonetic\": \"...\",\n" +
      "  \"notes\": \"...\"\n" +
      "}";

    var userPrompt =
      "Source language: " + src + "\n" +
      "Target language: " + tgt + "\n" +
      "Text: " + text;

    var resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!resp.ok) {
      var errText = await resp.text();
      return jsonResponse(500, { error: 'OpenAI API error', details: errText.slice(0, 2000), _meta: { version: APP_VERSION } });
    }

    var data = await resp.json();

    // Extract assistant content without optional chaining
    var content = '';
    if (data && data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === 'string') {
      content = data.choices[0].message.content;
    }

    var obj = null;
    try {
      obj = JSON.parse(content);
    } catch (e) {
      return jsonResponse(500, { error: 'Model did not return valid JSON', details: String(content).slice(0, 2000), _meta: { version: APP_VERSION } });
    }

    // Normalize output + remove Thai particles deterministically
    var out = {
      source_lang: (obj && obj.source_lang) ? obj.source_lang : src,
      target_lang: (obj && obj.target_lang) ? obj.target_lang : tgt,
      translation: (obj && obj.translation) ? obj.translation : '',
      phonetic: (obj && obj.phonetic) ? obj.phonetic : '',
      notes: (obj && obj.notes) ? obj.notes : ''
    };

    var targetIsThai = String(out.target_lang || tgt).toLowerCase() === 'thai' || String(tgt).toLowerCase() === 'thai';
    if (targetIsThai) {
      out.translation = stripThaiParticleAlways(out.translation);
      out.phonetic = stripPhoneticParticleAlways(out.phonetic);
    }

    out._meta = { version: APP_VERSION };

    return jsonResponse(200, out);
  } catch (err) {
    return jsonResponse(500, { error: 'Function crashed', details: String(err && err.message ? err.message : err), _meta: { version: APP_VERSION } });
  }
};
