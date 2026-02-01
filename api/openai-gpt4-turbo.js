// Vercel Serverless Function: /api/openai-gpt4-turbo.js
// Proxy seguro para chamada à OpenAI usando variável de ambiente

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
  const apiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave da API OpenAI não configurada no ambiente.' });
  }
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt não fornecido.' });
  }
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: 'Você é um assistente especialista em georreferenciamento de imóveis rurais brasileiros. Extraia apenas os vértices do polígono em UTM/SIRGAS2000, ordem correta, polígono fechado.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2048
      })
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({ error: data.error || 'Erro na API OpenAI' });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
