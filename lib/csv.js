'use strict';

/**
 * Minimal RFC 4180 CSV parser (replaces the csv-parse package).
 * Handles quoted fields, escaped quotes (""), embedded commas and newlines,
 * and both CRLF and LF line endings.
 *
 * @param {string} text
 * @returns {Array<Object>} rows keyed by the header row
 */
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '\r') {
      i += 1; // handled by the \n that follows
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Trailing field / row (file not ending in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const out = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    // Skip blank lines.
    if (cells.length === 1 && cells[0].trim() === '') continue;

    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = cells[c] !== undefined ? cells[c] : '';
    }
    out.push(obj);
  }

  return out;
}

module.exports = { parseCsv };
