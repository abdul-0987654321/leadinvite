# Magnetica Society — lead automation

Quiz form → Google Sheet → WhatsApp Channel invite.

Zero npm dependencies. Node 20+ only. `npm install` does nothing, which means
Render deploys in seconds and there is nothing to break or update later.

```
server.js       the live endpoint the quiz form posts to
bulk-send.js    one-time invite blast to the existing list
test.js         offline tests (no network, no credentials)
lib/phone.js    phone normalisation (Italian rules)
lib/csv.js      CSV parser
lib/sheets.js   Google Sheets via REST + service-account JWT
lib/whatsapp.js Meta Cloud API template sending
lib/env.js      .env loader
```

---

## 1. Google Sheet

1. Create a sheet. Name the first tab `Leads`.
2. Copy its ID from the URL: `docs.google.com/spreadsheets/d/<ID>/edit`
3. In Google Cloud Console: create a project → enable **Google Sheets API** →
   create a **Service Account** → **Keys** → add key → JSON → download.
4. **Share the sheet with the service account's `client_email` as Editor.**
   Skipping this is the single most common failure — every write returns 403.

The header row is created automatically on first boot.

> Hand the sheet over in the client's own Google account at the end, or transfer
> ownership to her. The whole point of this project is that she owns her data.

## 2. WhatsApp

1. Client creates a Meta Business account (hers, using her existing Facebook
   login — a brand-new Facebook account often gets restricted).
2. Add a WhatsApp Business Account inside it.
3. Register the new phone number — it must **not** be active on normal WhatsApp
   or WhatsApp Business.
4. Add a payment method. Without one, nothing sends.
5. Create the message template (see `template-it.md`) and wait for approval.
6. From **API Setup**, copy the Phone Number ID and a permanent access token.

## 3. Deploy to Render

- New → Web Service → connect the repo
- Build command: *(leave empty)*
- Start command: `node server.js`
- Add every variable from `.env.example`
- Deploy, then confirm `https://<your-app>.onrender.com/health` returns `{"ok":true}`

**Keep it awake.** The free tier sleeps after inactivity and a sleeping instance
drops incoming leads. Point UptimeRobot at `/health` every 5 minutes.

## 4. Connect the quiz form

Give whoever controls the website this URL:

```
https://<your-app>.onrender.com/lead?secret=<WEBHOOK_SECRET>
```

They replace the existing webhook URL with this one. Nothing else on the page
changes.

The endpoint accepts JSON or form-encoded bodies and recognises both Italian and
English field names (`nome`/`name`, `telefono`/`phone`, `email`). Unrecognised
fields are stored verbatim in the *Quiz answers* column, so no answer is lost
even if the page changes later.

## 5. Test before going live

```bash
node test.js                                    # offline checks
curl -X POST "https://<app>.onrender.com/lead?secret=<SECRET>" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"TEST","email":"t@t.it","telefono":"<your own number>"}'
```

Confirm: a row appears in the sheet, and the WhatsApp arrives on your phone.

## 6. The invite blast

```bash
node bulk-send.js --file LEADS1.csv                      # dry run, sends nothing
node bulk-send.js --file LEADS1.csv --only <your number> --send   # one test
node bulk-send.js --file LEADS1.csv --limit 3 --send             # three
node bulk-send.js --file LEADS1.csv --send                       # the real send
```

Every result is appended to `send-log.csv`. If the script crashes or is stopped,
re-running it **skips anyone already marked sent**, so nobody is messaged twice.

Flags: `--delay <ms>` (default 1500), `--limit N`, `--only <phone>`,
`--log <file>`.

## Notes

- Italian marketing messages cost roughly €0.057 each. 179 contacts ≈ €10.
- The endpoint always replies `200 OK` immediately, before touching Google or
  Meta, so the visitor never sees an error. Failures are logged with the full
  payload so a lead can be recovered by hand.
- `ensureHeaders` runs on boot and is safe to run repeatedly.
