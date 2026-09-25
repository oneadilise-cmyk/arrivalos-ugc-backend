// api/higgsfield.js — Vercel serverless function
//
// This is the ONLY place your Higgsfield credentials live. The browser never
// sees them. It receives requests from the ArrivalOS UGC Agent frontend and
// forwards them to Higgsfield's real API.
//
// Set these two environment variables in Vercel (Settings → Environment Variables):
//   HIGGSFIELD_KEY_ID      — your Higgsfield API Key ID
//   HIGGSFIELD_KEY_SECRET  — your Higgsfield API Key Secret
// (Higgsfield issues credentials as a KEY_ID + KEY_SECRET pair, not a single key.
//  Get both from https://cloud.higgsfield.ai → API Keys.)

const HF_BASE = 'https://api.higgsfield.ai';

// Higgsfield Soul 2 — confirmed real, working model ID straight from
// console.higgsfield.ai's own API docs for this account (Explore models →
// Soul 2 → API tab). This is a Higgsfield-owned model, not a licensed
// third-party one, which is why it's reliably available on the API.
const MODEL_ID = 'nano_banana_2';

export default async function handler(req, res) {
  // CORS — allows your Netlify-hosted frontend to call this Vercel function
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Higgsfield credentials not configured on the server' });
  }
  const authHeader = `Key ${keyId}:${keySecret}`;

  const { action } = req.body || {};

  try {
    // ── SUBMIT ONE PROMPT ──
    if (action === 'submit') {
      const { prompt, aspect_ratio } = req.body;
      if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

      const r = await fetch(`${HF_BASE}/generate/image/${MODEL_ID}`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, aspect_ratio: aspect_ratio || '1:1' })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data?.message || data?.error || `Higgsfield HTTP ${r.status}` });
      }
      if (!data.request_id) {
        return res.status(502).json({ error: 'Higgsfield did not return a request_id' });
      }
      return res.status(200).json({ job_id: data.request_id });
    }

    // ── POLL ONE JOB ──
    if (action === 'poll') {
      const { job_id } = req.body;
      if (!job_id) return res.status(400).json({ error: 'Missing job_id' });

      const r = await fetch(`${HF_BASE}/requests/${job_id}/status`, {
        headers: { 'Authorization': authHeader }
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data?.message || data?.error || `Higgsfield HTTP ${r.status}` });
      }

      let status = 'processing';
      if (data.status === 'completed') status = 'completed';
      else if (data.status === 'failed' || data.status === 'nsfw') status = 'failed';

      const image_url = (data.images && data.images[0] && data.images[0].url) || null;
      return res.status(200).json({ status, image_url });
    }

    return res.status(400).json({ error: 'Unknown action — expected "submit" or "poll"' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error contacting Higgsfield' });
  }
}
