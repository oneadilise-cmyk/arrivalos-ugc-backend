// Vercel serverless function: keeps Higgsfield credentials server-side.
// The page sends { action: 'submit', prompt, aspect_ratio } or { action: 'poll', job_id }.
// Docs: https://docs.higgsfield.ai (SOUL V2 text-to-image + GET /requests/{id}/status)

const HF_BASE = 'https://api.higgsfield.ai';
const MODEL = 'higgsfield-ai/soul/v2/standard';
const ALLOWED_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'];
const RATIO_FALLBACK = { '4:5': '3:4', '5:4': '4:3' };
const FAILED_STATES = ['failed', 'nsfw', 'canceled'];

// Accepts the env var names from Higgsfield's docs plus common variants,
// so existing Vercel settings keep working.
function getAuthHeader() {
  const combined = process.env.HF_CREDENTIALS || process.env.HIGGSFIELD_CREDENTIALS;
  if (combined) return `Key ${combined}`;

  const id =
    process.env.HF_API_KEY_ID ||
    process.env.HIGGSFIELD_API_KEY_ID ||
    process.env.HIGGSFIELD_KEY_ID ||
    process.env.HIGGSFIELD_API_KEY ||
    process.env.HIGGSFIELD_KEY ||
    process.env.HF_API_KEY;
  const secret =
    process.env.HF_API_KEY_SECRET ||
    process.env.HIGGSFIELD_API_KEY_SECRET ||
    process.env.HIGGSFIELD_KEY_SECRET ||
    process.env.HIGGSFIELD_API_SECRET ||
    process.env.HIGGSFIELD_API_SECRET_KEY ||
    process.env.HIGGSFIELD_SECRET_KEY ||
    process.env.HIGGSFIELD_SECRET ||
    process.env.HF_API_SECRET ||
    process.env.HF_SECRET;
  if (id && secret) return `Key ${id}:${secret}`;
  return null;
}

async function callHiggsfield(path, auth, options = {}) {
  const res = await fetch(`${HF_BASE}${path}`, {
    ...options,
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { detail: text.slice(0, 300) }; }
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data);
    const err = new Error(`Higgsfield HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuthHeader();
  if (!auth) {
    // Names only, never values, so a naming mismatch is easy to spot.
    const seen = Object.keys(process.env).filter(k => /^(HF_|HIGGSFIELD)/i.test(k));
    return res.status(500).json({
      error: 'Server is missing Higgsfield credentials. Set HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET in Vercel. ' +
        `Found: ${seen.length ? seen.join(', ') : 'none'}`,
    });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  try {
    if (body.action === 'submit') {
      const prompt = (body.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

      let aspect = RATIO_FALLBACK[body.aspect_ratio] || body.aspect_ratio || '9:16';
      if (!ALLOWED_RATIOS.includes(aspect)) aspect = '9:16';

      const data = await callHiggsfield(`/${MODEL}`, auth, {
        method: 'POST',
        body: JSON.stringify({ prompt, aspect_ratio: aspect, resolution: '1080p', batch_size: 1 }),
      });
      if (!data.request_id) return res.status(502).json({ error: 'Higgsfield returned no request_id' });
      return res.status(200).json({ job_id: data.request_id, status: data.status || 'queued' });
    }

    if (body.action === 'poll') {
      const id = String(body.job_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid job_id' });

      const data = await callHiggsfield(`/requests/${id}/status`, auth, { method: 'GET' });
      const status = FAILED_STATES.includes(data.status) ? 'failed' : data.status;
      const image_url = data.images?.[0]?.url || null;
      // Use `reason`, not `error`: the page treats any `error` field as a network failure and keeps retrying.
      return res.status(200).json({ status, image_url, reason: status === 'failed' ? data.error || data.status : undefined });
    }

    return res.status(400).json({ error: 'Unknown action — expected "submit" or "poll"' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
