# WhatsApp message template — submit this to Meta

Submit as early as possible. Approval is usually quick but it is the one step
outside your control, and **nothing can be sent until it is approved.**

Meta Business Suite → WhatsApp Manager → Message Templates → Create.

---

## Settings

| Field | Value |
|---|---|
| Name | `invito_canale` |
| Category | **Marketing** |
| Language | **Italian (it)** |

The name must match `WA_TEMPLATE_NAME` in the environment variables, and the
language must match `WA_TEMPLATE_LANG`.

---

## Header

None. (A plain-text template is approved faster than one with media.)

## Body

```
Ciao {{1}}! Sono Siria di Magnetica Society.

Grazie per aver completato il test "Che tipo di donna sei?".

Ti invito nel mio canale privato, dove ogni settimana condivido contenuti su posizionamento emotivo, desiderio e potere personale.

Tocca il pulsante qui sotto per entrare.
```

**Sample value for {{1}}:** `Giulia`

Meta will reject the submission without a sample, so fill that field in.

## Footer

```
Rispondi STOP per non ricevere piu messaggi.
```

An opt-out line is worth including. It helps approval, and more importantly it
gives people an alternative to pressing "Block" — blocks and spam reports damage
the number's quality rating, and a number with a low rating gets its sending
limit cut.

## Button

Type: **Visit website** (static URL)

| Field | Value |
|---|---|
| Button text | `Entra nel canale` |
| URL | the client's WhatsApp Channel invite link |

---

## Why this wording

The first line says who it is. These women opted in weeks or months ago and the
message arrives from a number they have never seen, so an unidentified message
gets reported as spam. Naming Siria and the test immediately is what makes the
difference between joining and blocking.

## If it gets rejected

Common causes, in order of likelihood:

1. **No sample value** for `{{1}}` — fill it in and resubmit.
2. **Category wrong.** This is Marketing, not Utility. Submitting a promotional
   message as Utility is rejected, and mis-categorising on purpose risks the
   account.
3. **Too promotional / salesy.** Remove any urgency or discount wording. The
   text above is deliberately plain.

Rejection is not fatal. Edit and resubmit — there is no penalty for a second
attempt.

## After approval

Send one test message to your own number before anything else:

```bash
node bulk-send.js --file LEADS1.csv --only <your number> --send
```

Check that your name appears correctly, the Italian reads naturally, and the
button opens the right Channel. Only then run the full send.
