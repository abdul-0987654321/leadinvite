'use strict';

/**
 * Normalise a phone number into the digits-only international format that the
 * WhatsApp Cloud API expects (no "+", no spaces, no punctuation).
 *
 * Italian numbers arrive in several shapes from web forms:
 *   +39 333 403 7385   ->  393334037385
 *   0039 3334037385    ->  393334037385
 *   3334037385         ->  393334037385   (bare mobile, default country applied)
 *   039 3334037385     ->  393334037385   (stray domestic trunk prefix)
 *
 * Returns null when the value cannot be turned into a plausible number, so the
 * caller can skip it instead of sending to a broken address.
 */
function normalisePhone(raw, defaultCountryCode = '39') {
  if (raw === undefined || raw === null) return null;

  let s = String(raw).trim();
  if (!s) return null;

  // Excel sometimes hands us 3.93334e+11 or a number primitive.
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    s = n.toFixed(0);
  }

  const hadPlus = s.startsWith('+');

  // Keep digits only.
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (!hadPlus) {
    if (digits.startsWith('00')) {
      // International dialling prefix.
      digits = digits.slice(2);
    } else if (digits.startsWith('0' + defaultCountryCode)) {
      // Stray zero in front of the country code, e.g. "039 333...".
      digits = digits.slice(1);
    }

    if (!digits.startsWith(defaultCountryCode)) {
      // NOTE: Italian landlines keep their leading 0 in international format
      // (02 Milan -> +39 02 ...), so the zero is deliberately NOT stripped here.
      digits = defaultCountryCode + digits;
    }
  }

  // Guard against obvious junk (too short to be a real international number,
  // or absurdly long).
  if (digits.length < 8 || digits.length > 15) return null;

  return digits;
}

module.exports = { normalisePhone };
