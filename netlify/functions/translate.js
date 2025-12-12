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
    const { action, text, sourceLang, targetLang, options, translation } =
      JSON.parse(event.body || '{}');

    if (!text || !targetLang) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text or targetLang' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set' }) };
    }

    const srcLang = sourceLang || 'auto';
    const opts = options || {};

    const wordCount = text.trim().split(/\s+/).length;

    const lowResourcePair =
      ((srcLang === 'Malay' || srcLang === 'Indonesian') && targetLang === 'Thai') ||
      ((targetLang === 'Malay' || targetLang === 'Indonesian') && srcLang === 'Thai');

    const modelForTranslate =
      (lowResourcePair && wordCount <= 2)
        ? 'gpt-4o'
        : 'gpt-4.1-mini';

    if (action === 'explain') {
      const prompt = `You are a language teacher.
Explain the following translation clearly in English.
Source: ${text}
Target: ${translation}
Tone, structure, and alternatives should be explained.`;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: 'Explain.' }
          ],
          temperature: 0.3,
        }),
      });

      const data = await res.json();
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          explanation: data.choices?.[0]?.message?.content || '',
        }),
      };
    }

    const systemPrompt = `You are a professional translator.

Rules:
- Translate from ${srcLang} to ${targetLang}.
- If input is 1–2 words, behave like a bilingual dictionary.
- Prefer real target-language words over transliteration.
- Thai output must NOT include ครับ or ค่ะ.
- Always provide phonetics for non-Latin scripts.
- Notes must be in English only.

Respond ONLY in JSON:
{
  "source_lang": "...",
  "target_lang": "...",
  "translation": "...",
  "phonetic": "...",
  "notes": "..."
}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelForTranslate,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: content,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
