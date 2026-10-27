'use strict';

/**
 * One-time invite blast to the existing lead list.
 *
 * Usage:
 *   node bulk-send.js --file LEADS1.csv --dry-run
 *   node bulk-send.js --file LEADS1.csv --limit 3        # test on 3 numbers
 *   node bulk-send.js --file LEADS1.csv --only 39333...  # one specific number
 *   node bulk-send.js --file LEADS1.csv                  # the real send
 *
 * Safety:
 *   - dry-run by default unless --send is passed
 *   - de-duplicates by normalised phone
 *   - writes a per-contact result log so a crash never means sending twice
 *   - skips anyone already marked sent in the log
 */

require('./lib/env').loadEnv();

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./lib/csv');
const { normalisePhone } = require('./lib/phone');
const { sendTemplate } = require('./lib/whatsapp');

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')
    ? args[i + 1]
    : fallback;
}
const has = (name) => args.includes(`--${name}`);

const FILE = arg('file', 'LEADS1.csv');
const LIMIT = Number(arg('limit', 0)) || 0;
const ONLY = arg('only', null);
const DELAY_MS = Number(arg('delay', 1500));
const DO_SEND = has('send');
const LOG_FILE = arg('log', 'send-log.csv');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- */

function loadRows(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

function firstNameOf(row) {
  const candidates = [
    row['Contact Name'], row.name, row.Name, row.nome, row['Opportunity name'],
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) {
      // "Giulia - 3334037385" -> "Giulia"
      return String(c).split(/[-–—]/)[0].trim().split(/\s+/)[0];
    }
  }
  return '';
}

function phoneOf(row) {
  const candidates = [row.phone, row.Phone, row.telefono, row['Phone Number']];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  return '';
}

function loadAlreadySent(logPath) {
  const done = new Set();
  if (!fs.existsSync(logPath)) return done;
  const raw = fs.readFileSync(logPath, 'utf8');
  for (const line of raw.split('\n')) {
    const [phone, status] = line.split(',');
    if (phone && status && status.trim() === 'sent') done.add(phone.trim());
  }
  return done;
}

function appendLog(logPath, phone, status, detail = '') {
  const safe = String(detail).replace(/[\r\n,]+/g, ' ').slice(0, 200);
  fs.appendFileSync(logPath, `${phone},${status},${safe},${new Date().toISOString()}\n`);
}

/* ---------------------------------------------------------------- */

async function main() {
  const filePath = path.resolve(FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rows = loadRows(filePath);
  console.log(`Loaded ${rows.length} rows from ${path.basename(filePath)}`);

  // Build the send list: normalise, drop blanks, de-duplicate.
  const seen = new Set();
  const list = [];
  let noPhone = 0;
  let badPhone = 0;
  let dupes = 0;

  for (const row of rows) {
    const raw = phoneOf(row);
    if (!raw) { noPhone += 1; continue; }

    const phone = normalisePhone(raw);
    if (!phone) { badPhone += 1; continue; }

    if (seen.has(phone)) { dupes += 1; continue; }
    seen.add(phone);

    list.push({ phone, firstName: firstNameOf(row) || 'ciao', raw });
  }

  console.log(
    `Ready: ${list.length} unique contacts ` +
    `(skipped ${noPhone} without a phone, ${badPhone} unusable, ${dupes} duplicates)`
  );

  const alreadySent = loadAlreadySent(LOG_FILE);
  if (alreadySent.size) {
    console.log(`Log shows ${alreadySent.size} already sent — those will be skipped.`);
  }

  let queue = list.filter((c) => !alreadySent.has(c.phone));
  if (ONLY) {
    const target = normalisePhone(ONLY);
    queue = queue.filter((c) => c.phone === target);
    console.log(`--only filter: ${queue.length} match(es)`);
  }
  if (LIMIT > 0) queue = queue.slice(0, LIMIT);

  // Italian mobiles are 39 + 10 digits = 12. Anything shorter that claims to be
  // an Italian mobile is almost certainly a typo in the source data and will be
  // rejected by Meta, so surface it before the send rather than after.
  const suspicious = queue.filter(
    (c) => c.phone.startsWith('393') && c.phone.length !== 12
  );

  if (!DO_SEND) {
    console.log('\n=== DRY RUN (no messages sent) ===');
    console.log(`Would send to ${queue.length} contacts. First 10:`);
    queue.slice(0, 10).forEach((c, i) =>
      console.log(`  ${i + 1}. ${c.phone}  (${c.firstName})  [from: ${c.raw}]`)
    );

    if (suspicious.length) {
      console.log(`\nWARNING: ${suspicious.length} number(s) look malformed for Italy:`);
      suspicious.forEach((c) =>
        console.log(`  ${c.phone}  (${c.firstName})  [from: ${c.raw}]  <- wrong length`)
      );
      console.log('  These will probably be rejected by Meta. Not an error, just expect failures.');
    }

    const estimate = (queue.length * 0.0572).toFixed(2);
    console.log(`\nEstimated Meta cost at Italian marketing rate: ~EUR ${estimate}`);
    console.log('\nAdd --send to actually send.');
    return;
  }

  console.log(`\nSending to ${queue.length} contacts, ${DELAY_MS}ms apart...\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const c = queue[i];
    const label = `[${i + 1}/${queue.length}] ${c.phone}`;

    try {
      const result = await sendTemplate(c.phone, [c.firstName]);
      if (result.ok) {
        sent += 1;
        console.log(`${label} sent`);
        appendLog(LOG_FILE, c.phone, 'sent', result.messageId || '');
      } else {
        failed += 1;
        const msg = result.error?.message || `HTTP ${result.status}`;
        console.error(`${label} FAILED: ${msg}`);
        appendLog(LOG_FILE, c.phone, 'failed', msg);

        // Rate limit: back off and retry this one later rather than burning through.
        if (result.status === 429 || /rate/i.test(msg)) {
          console.log('Rate limited — pausing 60s...');
          await sleep(60000);
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`${label} ERROR: ${err.message}`);
      appendLog(LOG_FILE, c.phone, 'error', err.message);
    }

    if (i < queue.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. Sent: ${sent}  Failed: ${failed}`);
  console.log(`Full results in ${LOG_FILE}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
