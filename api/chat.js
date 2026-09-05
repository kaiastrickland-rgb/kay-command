export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Command Chat AI is ready, but OPENAI_API_KEY has not been added to the Vercel project yet.'
    });
  }

  try {
    const { message, context } = req.body || {};
    const prompt = [
      'You are the assistant inside KAY // COMMAND, a concise executive task-management dashboard.',
      'Use the supplied project/task context when useful.',
      'Do not claim a database change happened unless the browser already performed it.',
      'Be direct, practical, and brief.',
      '',
      'CURRENT CONTEXT:',
      JSON.stringify(context || {}, null, 2),
      '',
      'USER:',
      String(message || '')
    ].join('\n');

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        input: prompt
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'OpenAI request failed' });

    const reply = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(c => c.type === 'output_text')
      .map(c => c.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply: reply || 'I processed that request.' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unexpected server error' });
  }
}
