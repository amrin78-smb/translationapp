exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { text, sourceLang, targetLang, options, action, translation } = JSON.parse(event.body || '{}');
    if (!text || !targetLang) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text or targetLang' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set' }) };
    }

    const srcLang = sourceLang || 'auto';
    const opts = options || {};
    const optionsDescription = JSON.stringify(opts);

    // Simple glossary for critical words where we want guaranteed behavior.
    const glossary = {
      "cempedak": {
        "Thai": {
          translation: "จำปาดะ",
          phonetic: "jampada",
          source_lang: "Malay",
          notes: "Malay fruit similar to jackfruit. Standard Thai word is 'จำปาดะ' (jampada); do not transliterate."
        }
      }
    };

    const key = text.trim().toLowerCase();
    const glossaryHit = glossary[key] && glossary[key][targetLang];

    // If glossary contains an exact mapping, return it directly (no model call).
    if (action === 'translate' && glossaryHit) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          source_lang: glossaryHit.source_lang || (srcLang === 'auto' ? 'Malay' : srcLang),
          target_lang: targetLang,
          translation: glossaryHit.translation,
          phonetic: glossaryHit.phonetic || '',
          notes: glossaryHit.notes || 'Result provided from built-in glossary to ensure correct everyday term in the target language.'
        }),
      };
    }

    // Decide model based on language pair and length
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const lowResourcePair =
      ((srcLang === 'Malay' || srcLang === 'Indonesian') && targetLang === 'Thai') ||
      ((targetLang === 'Malay' || targetLang === 'Indonesian') && srcLang === 'Thai');

    // For very short Malay/Indonesian <-> Thai, use full gpt-4.1 as a "dictionary mode"
    const modelForTranslate = (lowResourcePair && wordCount <= 2) ? 'gpt-4.1' : 'gpt-4.1-mini';

    if (action === 'explain') {
      const explanationPrompt = `
You are a language teacher helping a learner understand a translation.

Input JSON (as string):
${JSON.stringify({ text, sourceLang: srcLang, targetLang, translation, options: opts })}

Requirements:
- Explain the translation in clear English.
- Break down important words or phrases and what they mean.
- Mention tone and politeness (casual vs formal).
- If relevant, comment on particles like "ครับ/ค่ะ" in Thai or formality differences like "tu/vous" in French or "usted/tú" in Spanish.
- Suggest 1-2 alternative ways to say it if helpful.
- Do NOT repeat the entire translation unless needed for clarity.
- Respond ONLY in JSON with this structure:

{
  "explanation": "detailed explanation in English"
}
`.trim();

      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: explanationPrompt },
            { role: 'user', content: 'Explain the translation based on the input JSON above.' }
          ],
          temperature: 0.3,
        }),
      });

      const data = await openAiRes.json();
      const content = data.choices?.[0]?.message?.content || '';
      let result;
      try {
        result = JSON.parse(content);
      } catch {
        result = { raw: content, error: 'Failed to parse JSON.' };
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(result),
      };
    }

    const systemPrompt = `
You are a translation engine.

Context:
- Requested source language: ${srcLang}
- Target language: ${targetLang}
- Options (JSON): ${optionsDescription}

Source language handling:
- If requested source language is "auto", you MUST detect the actual source language from the text.
- If requested source language is a specific language (e.g., "Thai", "Malay", "French"), you MUST treat the input text as being written in that language and translate from there.
- In the "source_lang" field, you should report the detected/assumed source language in English. If the requested source differs slightly from detection, prefer the requested one but you may note the actual detection in the "notes" field.

Options meaning (if present):
- gender: "male" or "female" (for how the user will speak, mainly relevant to Thai polite particles)
- thai_formality: "casual" (casual friendly) or "polite" (more polite but still natural)
- chinese_script: "simplified" or "traditional"
- japanese_politeness: "polite" or "casual"
- korean_formality: "formal" or "casual"

GENERAL RULES:
- Always aim for natural, idiomatic speech in the target language, not word-for-word literal translation.
- If the target language does not use Latin script (e.g., Thai, Chinese, Japanese, Korean), the "phonetic" field MUST contain a readable romanization.
- For Latin-script languages (English, French, Spanish, German, Indonesian, Vietnamese), "phonetic" may be IPA or may be an empty string if not necessary.

DICTIONARY MODE FOR VERY SHORT INPUTS (IMPORTANT):
- If the input consists of 1–2 words, you must behave like a high-quality bilingual dictionary for the requested source and target languages.
- In dictionary mode, your primary goal is to output the standard everyday target-language word used by native speakers, NOT a transliteration.
- Only keep or transliterate the source word when it is clearly a proper name (person, brand, specific place) or when there is no widely-used local term in the target language.

TRANSLITERATION VS REAL WORDS (IMPORTANT):
- If the source text is a word or short phrase referring to a common object, food, place, or concept and there is a standard everyday word in the target language, you MUST use that actual target-language word.
- Only use a transliteration (writing the source pronunciation in the target script) when:
  - It is a proper name (person, brand, specific place), OR
  - There is no widely used local term in the target language.
- Examples:
  - Malay "durian" -> Thai "ทุเรียน", not a phonetic spelling.
  - Malay "cempedak" -> Thai "จำปาดะ", not a Thai transliteration of "cempedak".
  - If there is a widely recognized borrowed word already established in the target language, use that established form.

SPECIAL RULES FOR THAI OUTPUT:
- Write the translation in natural spoken Thai (ภาษาพูด), matching the requested thai_formality:
  - "casual": friendly, everyday speech but still polite enough for normal interaction.
  - "polite": slightly more polite and suitable for talking to strangers or in semi-formal context.
- DO NOT include polite particles such as "ครับ" or "ค่ะ" in the Thai translation itself.
- Keep sentences concise, friendly, and typical of real Thai speech.

SPECIAL RULES FOR CHINESE:
- Use the requested "chinese_script" ("simplified" vs "traditional") for the translation.
- Always provide "phonetic" using Pinyin with tone marks or numbers.

SPECIAL RULES FOR JAPANESE:
- Respect "japanese_politeness":
  - "polite": です/ます form.
  - "casual": dictionary/plain form when appropriate.
- Provide "phonetic" using romaji.

SPECIAL RULES FOR KOREAN:
- Respect "korean_formality":
  - "formal": polite formal endings (e.g., -요 or -입니다 forms depending on context).
  - "casual": more casual banmal or semi-formal depending on context.
- Provide "phonetic" using a simple Latin transliteration.

RULES FOR NOTES:
- The "notes" field MUST ALWAYS be written in clear English.
- Use "notes" to explain tone, politeness level, any important usage tips, and (if relevant) source-language detection vs requested source.
- For French/Spanish, use notes to mention formality (e.g., "tu" vs "vous" or "tú" vs "usted") when relevant.
- Do NOT write notes in the target language.

Respond ONLY in strict JSON with this structure:

{
  "source_lang": "detected or assumed source language in English",
  "target_lang": "target language in English",
  "translation": "translated text (respecting rules above)",
  "phonetic": "romanization or phonetic (or empty string if truly not needed)",
  "notes": "English-only description of tone, politeness, usage, and any detection comments"
}
`.trim();

    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelForTranslate,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.2,
      }),
    });

    const data = await openAiRes.json();
    const content = data.choices?.[0]?.message?.content || '';
    let result;

    try {
      result = JSON.parse(content);
    } catch {
      result = { raw: content, error: 'Failed to parse JSON.' };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
