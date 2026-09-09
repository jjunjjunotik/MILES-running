/**
 * MILES · coach proxy
 *
 * The app is a static front end, so it must never hold an Anthropic API key —
 * anything shipped to a browser is public. This tiny server is the other half:
 * it keeps the key, calls Claude, and hands back plain text.
 *
 *   npm install @anthropic-ai/sdk
 *   export ANTHROPIC_API_KEY=sk-ant-...      # or run `ant auth login`
 *   node server/coach-proxy.mjs
 *
 * Then in the app: You → Coach AI → endpoint → http://localhost:8787/coach
 *
 * Deploying this publicly? Put it behind your own auth and rate limiting, and
 * narrow ALLOW_ORIGIN — as written it will answer anyone who can reach it, and
 * every answer is billed to your key.
 */

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const MODEL = process.env.COACH_MODEL || 'claude-opus-5';
const MAX_BODY = 128 * 1024;

// Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
// profile — never hardcode a key here.
const client = new Anthropic();

const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** The app sends {system, messages}; messages are {role, content} turns. */
function parseRequest(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('Body must be JSON.'), { status: 400 });
  }

  const system = typeof parsed.system === 'string' ? parsed.system : '';
  const incoming = Array.isArray(parsed.messages) ? parsed.messages : [];
  const messages = incoming
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 8000),
    }));

  if (!messages.length) throw Object.assign(new Error('No messages.'), { status: 400 });
  // The Messages API requires the conversation to end on a user turn.
  if (messages[messages.length - 1].role !== 'user') {
    throw Object.assign(new Error('The last message must be from the runner.'), { status: 400 });
  }
  return { system, messages };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/coach')) {
    send(res, 404, { error: 'POST /coach' });
    return;
  }

  try {
    const { system, messages } = parseRequest(await readBody(req));

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Adaptive thinking is the current API; budget_tokens is removed on this
      // model family and would be rejected.
      thinking: { type: 'adaptive' },
      // Server-side fallbacks: if a safety classifier declines, the same
      // request is re-run on a fallback model inside this one call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages,
    });

    // Always check stop_reason before reading content — a refusal is a 200.
    if (response.stop_reason === 'refusal') {
      send(res, 200, {
        text: 'I could not answer that one. Try asking about your training — pace, mileage, or the plan.',
        refused: true,
      });
      return;
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    send(res, 200, { text, model: response.model, usage: response.usage });
  } catch (error) {
    // A missing key throws client-side, before any HTTP call, so it arrives
    // with no status at all — catch that case by shape, not by status code.
    const raw = error?.message || String(error);
    const noCredentials = /resolve authentication method|apiKey or authToken/i.test(raw);
    const status = noCredentials ? 401
      : (error?.status && Number.isInteger(error.status) ? error.status : 500);

    const message = noCredentials || status === 401 || status === 403
      ? 'No Anthropic credentials. Set ANTHROPIC_API_KEY before starting this proxy '
        + '(export ANTHROPIC_API_KEY=sk-ant-... && npm run coach), or run `ant auth login`.'
      : raw || 'The coach request failed.';

    console.error('[coach-proxy]', status, message);
    send(res, status >= 400 && status < 600 ? status : 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`MILES coach proxy on http://localhost:${PORT}/coach  (model: ${MODEL})`);
});
