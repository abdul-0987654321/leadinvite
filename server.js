'use strict';

require('./lib/env').loadEnv();

const http = require('http');
const { URL } = require('url');

const { normalisePhone } = require('./lib/phone');
const { sendTemplate } = require('./lib/whatsapp');
const sheets = require('./lib/sheets');

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.WEBHOOK_SECRET || '';

/* ------------------------------------------------------------------ *
 * Request body parsing (JSON or form-encoded — a form may post either)
 * ------------------------------------------------------------------ */
function readBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType = '') {
  const text = (raw || '').trim();
  if (!text) return {};

  if (contentType.includes('application/json') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  // application/x-www-form-urlencoded
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // The quiz page lives on another domain, so the browser needs this.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/* ------------------------------------------------------------------ *
 * Field mapping — the quiz page may use Italian or English field names,
 * so accept whatever shape arrives rather than demanding one format.
 * ------------------------------------------------------------------ */
function pick(body, keys) {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return '';
}

const KNOWN_KEYS = new Set([
  'name', 'nome', 'first_name', 'firstName', 'full_name', 'fullName',
  'contact_name', 'Contact Name', 'email', 'mail', 'e-mail', 'Email',
  'phone', 'telefono', 'tel', 'phone_number', 'phoneNumber', 'mobile', 'Phone',
  'quiz_result', 'result', 'archetipo', 'archetype', 'risultato',
  'source', 'utm_source', 'secret',
]);

function extractLead(body) {
  const phoneRaw = pick(body, [
    'phone', 'telefono', 'tel', 'phone_number', 'phoneNumber', 'mobile', 'Phone',
  ]);

  // Anything unrecognised is kept verbatim, so no quiz answer is silently lost
  // if the page's field names change later.
  const extras = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!KNOWN_KEYS.has(k)) extras[k] = v;
  }

  return {
    name: pick(body, [
      'name', 'nome', 'first_name', 'firstName', 'full_name', 'fullName',
      'contact_name', 'Contact Name',
    ]),
    email: pick(body, ['email', 'mail', 'e-mail', 'Email']),
    phoneRaw,
    phone: normalisePhone(phoneRaw),
    quizResult: pick(body, ['quiz_result', 'result', 'archetipo', 'archetype', 'risultato']),
    quizAnswers: Object.keys(extras).length ? JSON.stringify(extras) : '',
    source: pick(body, ['source', 'utm_source']) || 'quiz-funnel',
    timestamp: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Lead processing — runs AFTER the response has gone back to the page.
 * ------------------------------------------------------------------ */
async function processLead(lead, rawBody) {
  let rowNumber = null;

  try {
    rowNumber = await sheets.appendLead(lead);
    console.log(`[lead] saved row ${rowNumber} for ${lead.name || '(no name)'}`);
  } catch (err) {
    console.error('[lead] FAILED to write to sheet:', err.message);
    // Log the payload so nothing is lost even when Sheets is down.
    console.error('[lead] payload was:', rawBody);
  }

  if (!lead.phone) {
    console.warn(`[lead] no usable phone for ${lead.email || '(no email)'} — skipping WhatsApp`);
    await safeStatus(rowNumber, 'skipped: no phone');
    return;
  }

  try {
    const firstName = (lead.name || '').split(/\s+/)[0] || 'ciao';
    const result = await sendTemplate(lead.phone, [firstName]);

    if (result.ok) {
      console.log(`[lead] WhatsApp sent to ${lead.phone} (${result.messageId})`);
      await safeStatus(rowNumber, 'sent', result.messageId || '');
    } else {
      const msg = result.error?.message || `HTTP ${result.status}`;
      console.error(`[lead] WhatsApp FAILED for ${lead.phone}: ${msg}`);
      await safeStatus(rowNumber, `failed: ${msg}`.slice(0, 250));
    }
  } catch (err) {
    console.error('[lead] WhatsApp threw:', err.message);
    await safeStatus(rowNumber, `error: ${err.message}`.slice(0, 250));
  }
}

async function safeStatus(rowNumber, status, messageId = '') {
  try {
    await sheets.updateWhatsAppStatus(rowNumber, status, messageId);
  } catch (err) {
    console.error('[lead] could not update status column:', err.message);
  }
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  // CORS preflight, in case the form posts JSON from the browser.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Health checks — UptimeRobot pings these so the free Render instance
  // never sleeps. A sleeping instance drops incoming leads.
  if (req.method === 'GET' && (route === '/' || route === '/health')) {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  // Meta webhook verification handshake.
  if (req.method === 'GET' && route === '/webhook/whatsapp') {
    const verifyToken = process.env.WA_VERIFY_TOKEN;
    if (
      url.searchParams.get('hub.mode') === 'subscribe' &&
      verifyToken &&
      url.searchParams.get('hub.verify_token') === verifyToken
    ) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(url.searchParams.get('hub.challenge') || '');
      return;
    }
    res.writeHead(403);
    res.end();
    return;
  }

  // Inbound WhatsApp events (replies, delivery status).
  if (req.method === 'POST' && route === '/webhook/whatsapp') {
    sendJson(res, 200, { ok: true });
    try {
      const raw = await readBody(req);
      console.log('[wa-webhook]', raw.slice(0, 2000));
    } catch {
      /* ignore */
    }
    return;
  }

  // The quiz form posts here.
  if (req.method === 'POST' && (route === '/lead' || route === '/webhook/lead')) {
    let raw = '';
    try {
      raw = await readBody(req);
    } catch (err) {
      sendJson(res, 413, { ok: false, error: err.message });
      return;
    }

    const body = parseBody(raw, req.headers['content-type'] || '');

    if (SHARED_SECRET) {
      const provided =
        req.headers['x-webhook-secret'] ||
        url.searchParams.get('secret') ||
        body.secret ||
        '';
      if (provided !== SHARED_SECRET) {
        console.warn('[lead] rejected: bad or missing secret');
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
    }

    // Respond immediately. The page must never wait on Google or Meta, and
    // must never see an error — a failed response can show the visitor an
    // error even though we already have her details.
    sendJson(res, 200, { ok: true });

    const lead = extractLead(body);
    processLead(lead, raw).catch((err) =>
      console.error('[lead] unhandled:', err && err.message)
    );
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, async () => {
  console.log(`Magnetica lead server listening on :${PORT}`);
  try {
    const created = await sheets.ensureHeaders();
    console.log(created ? 'Sheet headers created.' : 'Sheet headers verified.');
  } catch (err) {
    console.error('WARNING: could not verify sheet headers:', err.message);
  }
});

// Never let one bad request kill the process — a dead server means lost leads.
process.on('unhandledRejection', (err) =>
  console.error('[unhandledRejection]', err && err.message)
);
process.on('uncaughtException', (err) =>
  console.error('[uncaughtException]', err && err.message)
);
