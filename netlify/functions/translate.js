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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY not set' }) };
  }

  const payload = JSON.parse(event.body || '{}');
  const { action, text, sourceLang, targetLang, translation } = payload;

  const callOpenAI = async (systemPrompt) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text || '' }
        ],
        temperature: 0.2,
      }),
    });
    return res.json();
  };

  try {
    if (action === 'explain') {
      const explainPrompt = `You are a language teacher.
Explain the following translation clearly in English.
Source sentence: ${text}
Translated sentence: ${translation}
Explain structure, meaning, and alternatives.`;

      const data = await callOpenAI(explainPrompt);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          explanation: data.choices?.[0]?.message?.content || '',
        }),
      };
    }

    const basePrompt = `You are a professional human translator.

Rules:
- Translate from ${sourceLang || 'auto'} to ${targetLang}.
- If input is 1–2 words, behave like a dictionary, not a transliterator.
- Prefer real target-language words over phonetic borrowing.
- Thai output must NEVER include ครับ or ค่ะ.
- Always include phonetics for non-Latin scripts.
- Notes MUST be in English.
- Output MUST be valid JSON only.

Required JSON format:
{
  "source_lang": "...",
  "target_lang": "...",
  "translation": "...",
  "phonetic": "...",
  "notes": "..."
}`;

    let data = await callOpenAI(basePrompt);
    let raw = data.choices?.[0]?.message?.content || '';

    try {
      JSON.parse(raw);
    } catch {
      // Retry once with stricter instruction
      const retryPrompt = basePrompt + "\n\nIMPORTANT: Output ONLY raw JSON. No text before or after.";
      data = await callOpenAI(retryPrompt);
      raw = data.choices?.[0]?.message?.content || '';
      JSON.parse(raw); // throws if still invalid
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: raw,
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
