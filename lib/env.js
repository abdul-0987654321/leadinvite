'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader (replaces the dotenv package).
 * Existing process.env values always win, which is what hosting platforms expect.
 */
function loadEnv(file = '.env') {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return;

  const text = fs.readFileSync(full, 'utf8');

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip surrounding quotes and unescape \n inside quoted values
    // (service-account private keys need this).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnv };
