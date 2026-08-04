api/higgsfield.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, prompts } = req.body;
  const apiKey = process.env.HIGGSFIELD_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    if (action === 'generate' || action === 'batch') {
      // Submit batch of prompts
      const jobs = await Promise.all(
        prompts.map(prompt =>
          fetch('https://api.higgsfield.ai/v1/image/generate', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              prompt: prompt.text,
              model: 'nano-banana-2-pro',
              width: prompt.width,
              height: prompt.height
            })
          })
          .then(r => {
