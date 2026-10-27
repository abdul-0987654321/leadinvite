'use strict';

const fs = require('fs');
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column order of the lead sheet. Keep in sync with the header row.
const HEADERS = [
  'Timestamp',
  'Name',
  'Email',
  'Phone (raw)',
  'Phone (normalised)',
  'Quiz result',
  'Quiz answers',
  'Source',
  'WhatsApp status',
  'WhatsApp message ID',
  'Notes',
];

let cachedToken = null; // { value, expiresAt }

/* ------------------------------------------------------------------ *
 * Auth: service-account JWT -> OAuth access token
 * ------------------------------------------------------------------ */

function getCredentials() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const text = inline.trim().startsWith('{')
      ? inline
      : Buffer.from(inline, 'base64').toString('utf8');
    return JSON.parse(text);
  }

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(fs.readFileSync(path, 'utf8'));

  throw new Error(
    'Missing Google credentials: set GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64) ' +
      'or GOOGLE_APPLICATION_CREDENTIALS (path to the key file).'
  );
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const creds = getCredentials();
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer
    .sign(creds.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(
      `Google auth failed (${res.status}): ${json?.error_description || json?.error || 'unknown'}`
    );
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

/* ------------------------------------------------------------------ *
 * Sheets REST helpers
 * ------------------------------------------------------------------ */

async function sheetsRequest(method, pathAndQuery, body) {
  const token = await getAccessToken();
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error('Missing SHEET_ID.');

  const res = await fetch(`${API}/${spreadsheetId}${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Sheets API ${method} ${pathAndQuery} failed (${res.status}): ` +
        (json?.error?.message || 'unknown error')
    );
  }
  return json;
}

const tab = () => process.env.SHEET_TAB || 'Leads';
const enc = (range) => encodeURIComponent(range);

/** Create the header row if the sheet is empty. Safe to call repeatedly. */
async function ensureHeaders() {
  const existing = await sheetsRequest('GET', `/values/${enc(`${tab()}!A1:Z1`)}`);

  if (!existing.values || existing.values.length === 0) {
    await sheetsRequest(
      'PUT',
      `/values/${enc(`${tab()}!A1`)}?valueInputOption=RAW`,
      { values: [HEADERS] }
    );
    return true;
  }
  return false;
}

/**
 * Append one lead as a new row.
 * @returns {Promise<number|null>} 1-based row number when the API reports it
 */
async function appendLead(lead) {
  const row = [
    lead.timestamp || new Date().toISOString(),
    lead.name || '',
    lead.email || '',
    lead.phoneRaw || '',
    lead.phone || '',
    lead.quizResult || '',
    lead.quizAnswers || '',
    lead.source || '',
    lead.waStatus || '',
    lead.waMessageId || '',
    lead.notes || '',
  ];

  const res = await sheetsRequest(
    'POST',
    `/values/${enc(`${tab()}!A:K`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [row] }
  );

  const updatedRange = res?.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Update the WhatsApp status columns (I and J) of an existing row. */
async function updateWhatsAppStatus(rowNumber, status, messageId = '') {
  if (!rowNumber) return;
  await sheetsRequest(
    'PUT',
    `/values/${enc(`${tab()}!I${rowNumber}:J${rowNumber}`)}?valueInputOption=RAW`,
    { values: [[status, messageId]] }
  );
}

/** Every normalised phone already in the sheet, for duplicate checks. */
async function getExistingPhones() {
  const res = await sheetsRequest('GET', `/values/${enc(`${tab()}!E2:E`)}`);
  const rows = res.values || [];
  return new Set(rows.map((r) => (r[0] || '').trim()).filter(Boolean));
}

module.exports = {
  HEADERS,
  ensureHeaders,
  appendLead,
  updateWhatsAppStatus,
  getExistingPhones,
};
