'use strict';

/**
 * Offline tests — no network, no credentials needed.
 * Run with: node test.js
 */

const assert = require('assert');
const { normalisePhone } = require('./lib/phone');
const { parseCsv } = require('./lib/csv');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${label}\n        ${err.message}`);
  }
}

console.log('\nPhone normalisation');
check('international with spaces', () =>
  assert.strictEqual(normalisePhone('+39 333 403 7385'), '393334037385'));
check('00 prefix', () =>
  assert.strictEqual(normalisePhone('00393334037385'), '393334037385'));
check('bare italian mobile gets +39', () =>
  assert.strictEqual(normalisePhone('3334037385'), '393334037385'));
check('stray zero before country code', () =>
  assert.strictEqual(normalisePhone('039 3334037385'), '393334037385'));
check('italian landline keeps its leading zero', () =>
  assert.strictEqual(normalisePhone('02 1234567'), '39021234567'));
check('foreign numbers untouched', () => {
  assert.strictEqual(normalisePhone('+61412345678'), '61412345678');
  assert.strictEqual(normalisePhone('+905301112233'), '905301112233');
  assert.strictEqual(normalisePhone('+41 79 123 45 67'), '41791234567');
});
check('already normalised passes through', () =>
  assert.strictEqual(normalisePhone('393334037385'), '393334037385'));
check('scientific notation from excel', () =>
  assert.strictEqual(normalisePhone('3.933340373850e+11'), '393334037385'));
check('junk rejected', () => {
  assert.strictEqual(normalisePhone(''), null);
  assert.strictEqual(normalisePhone('   '), null);
  assert.strictEqual(normalisePhone('abc'), null);
  assert.strictEqual(normalisePhone('123'), null);
  assert.strictEqual(normalisePhone(null), null);
  assert.strictEqual(normalisePhone(undefined), null);
});

console.log('\nCSV parsing');
check('basic rows', () => {
  const rows = parseCsv('a,b\n1,2\n3,4\n');
  assert.deepStrictEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});
check('quoted field with comma', () => {
  const rows = parseCsv('name,note\n"Rossi, Giulia",hello\n');
  assert.strictEqual(rows[0].name, 'Rossi, Giulia');
});
check('escaped quotes', () => {
  const rows = parseCsv('a\n"say ""hi"""\n');
  assert.strictEqual(rows[0].a, 'say "hi"');
});
check('embedded newline inside quotes', () => {
  const rows = parseCsv('a,b\n"line1\nline2",x\n');
  assert.strictEqual(rows[0].a, 'line1\nline2');
  assert.strictEqual(rows[0].b, 'x');
});
check('CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(rows, [{ a: '1', b: '2' }]);
});
check('BOM stripped', () => {
  const rows = parseCsv('﻿a,b\n1,2\n');
  assert.deepStrictEqual(Object.keys(rows[0]), ['a', 'b']);
});
check('no trailing newline', () => {
  const rows = parseCsv('a,b\n1,2');
  assert.deepStrictEqual(rows, [{ a: '1', b: '2' }]);
});
check('blank lines skipped', () => {
  const rows = parseCsv('a\n1\n\n2\n');
  assert.strictEqual(rows.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
