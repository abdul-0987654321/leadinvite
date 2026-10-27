'use strict';

const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || 'v21.0';

/**
 * Send an approved WhatsApp template message via the Meta Cloud API.
 *
 * @param {string} to        digits-only international number (e.g. 393334037385)
 * @param {string[]} params  body variables, in order ({{1}}, {{2}}, ...)
 * @returns {Promise<{ok: boolean, status: number, messageId?: string, error?: object}>}
 */
async function sendTemplate(to, params = []) {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_TOKEN;
  const templateName = process.env.WA_TEMPLATE_NAME;
  const language = process.env.WA_TEMPLATE_LANG || 'it';

  if (!phoneNumberId || !token || !templateName) {
    throw new Error(
      'Missing WhatsApp config: WA_PHONE_NUMBER_ID, WA_TOKEN and WA_TEMPLATE_NAME are all required.'
    );
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const components = [];
  if (params.length) {
    components.push({
      type: 'body',
      parameters: params.map((text) => ({ type: 'text', text: String(text) })),
    });
  }

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failure: no HTTP status at all.
    return { ok: false, status: 0, error: { message: err.message } };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: json?.error || json || {} };
  }

  return {
    ok: true,
    status: res.status,
    messageId: json?.messages?.[0]?.id,
  };
}

module.exports = { sendTemplate };
