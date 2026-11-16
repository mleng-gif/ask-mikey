// Morbius — live answers for "Ask me about Mikey".
// Streams plain text back to the page. The brief (everything Morbius knows) lives here, server-side.
import { BRIEF } from './_brief.mjs';

const MODEL = process.env.AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-5.5';
const GATEWAY = 'https://ai-gateway.vercel.sh/v1/messages';
const MAX_TURNS = 12;        // messages of history sent per request
const MAX_CHARS = 600;       // per visitor message
const LIMIT = 20;            // questions per visitor…
const WINDOW_MS = 10 * 60e3; // …per 10 minutes (best effort, per instance)
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

function clean(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages.slice(-MAX_TURNS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.slice(0, m.role === 'user' ? MAX_CHARS : 2000).trim();
    if (!content) continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

export default async function handler(req, res) {
  const off = process.env.MORBIUS_LIVE === 'off';
  if (req.method === 'GET') { res.setHeader('cache-control', 'no-store'); return res.status(200).json({ live: !off }); }
  if (req.method !== 'POST') return res.status(405).end();
  if (off) return res.status(503).json({ error: 'off' });

  // only answer the page itself, not other sites
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'origin' }); } catch { return res.status(403).end(); } }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const messages = clean(body.messages);
  if (!messages) return res.status(400).json({ error: 'bad_request' });

  const token = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
  if (!token) return res.status(503).json({ error: 'no_credentials' });

  let upstream;
  try {
    upstream = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-api-key': token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 450,
        stream: true,
        system: [{ type: 'text', text: BRIEF, cache_control: { type: 'ephemeral' } }],
        messages
      })
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream' });
  }
  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 429 ? 429 : 502;
    console.error('gateway', upstream.status, (await upstream.text().catch(() => '')).slice(0, 300));
    return res.status(status).json({ error: status === 429 ? 'rate_limited' : 'upstream' });
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') res.write(ev.delta.text);
        } catch { /* partial or non-JSON line */ }
      }
    }
  } catch (e) {
    console.error('stream', e && e.message);
  }
  res.end();
}
