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
    const { text, targetLang } = JSON.parse(event.body || '{}');
    if (!text || !targetLang) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text or targetLang' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set' }) };
    }

    const systemPrompt = `
You are a translation engine.
Detect the source language and translate the user text into ${targetLang}.

SPECIAL RULES FOR THAI OUTPUT:
- Write the translation in natural, casual spoken Thai (ภาษาพูดทั่วไป), the way Thai people really speak.
- It must still be polite, but not overly formal or textbook-like.
- DO NOT include polite particles such as "ครับ" or "ค่ะ" in the Thai translation itself.
- Avoid literal translations if unnatural. Prioritize natural spoken Thai phrasing.
- Keep sentences concise, friendly, and typical of everyday conversation.

IMPORTANT RULES FOR ALL LANGUAGES:
- The "notes" field MUST ALWAYS be written in clear English.
- The "notes" field should describe tone, politeness, or usage guidance, not repeat the translation.
- Do NOT write the notes in Thai or any other target language — English ONLY.

Respond ONLY in strict JSON with this structure:

{
  "source_lang": "detected source language in English",
  "target_lang": "target language in English",
  "translation": "natural casual Thai WITHOUT polite particles (or target language text if not Thai)",
  "phonetic": "romanization or phonetic (or empty string)",
  "notes": "English-only description of tone, politeness, and usage"
}
`.trim();

    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
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
