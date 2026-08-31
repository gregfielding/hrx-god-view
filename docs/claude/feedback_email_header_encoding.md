# ☠️ Raw UTF-8 in an email Subject header ships mojibake (2026-08-31)

Greg spotted a sent Sodexo campus email whose subject read:

> One shift, zero risk **Ã¢Â€Â”** Bethune Cookman University

**198 touch-2 emails went out this way** before it was caught. The body of
the same message rendered perfectly — that contrast is the diagnostic.

## What it decodes to

`Ã¢Â€Â”` → bytes `C3 A2 C2 80 C2 94` → read as Latin-1 → `â` `\x80` `\x94`
→ `E2 80 94` → **UTF-8 for `—` (U+2014 EM DASH)**.

So the em dash's UTF-8 bytes were interpreted as Latin-1 and re-encoded as
UTF-8 — double mojibake. The `Â€` / `Â”` form (rather than `â€"`) is the tell
that it passed through **ISO-8859-1** specifically, not Windows-1252.

## The rule

`Content-Type: text/plain; charset="UTF-8"` declares the charset of the
**BODY ONLY**. Headers are governed separately by RFC 5322 and **must be
pure ASCII**. Non-ASCII header text has to be an RFC 2047 encoded-word:

```
Subject: =?UTF-8?B?T25lIHNoaWZ0LCB6ZXJvIHJpc2sg4oCUIEJldGh1bmUgQ29va21hbiBVbml2?=
 =?UTF-8?B?ZXJzaXR5?=
```

That is exactly why the body was fine and the subject was not. **A body that
renders correctly tells you nothing about the headers.**

## Use the shared helper

`functions/src/sales/mimeHeaders.ts` — `buildMimeMessage()` and
`encodeMimeHeaderValue()`. Never hand-roll `Subject: ${subject}` again.
Three senders had independently rolled their own and all three were wrong:
`sodexoOutreach.ts`, `crmReengagement.ts`, `gmailTasksIntegration.ts` (that
last one also had **no** `MIME-Version`/`Content-Type` and joined headers
with bare `\n` instead of the CRLF RFC 5322 requires).

Non-obvious details the helper handles, each of which is its own bug if you
reimplement it:

- **Encoded-words cap at 75 chars** including the `=?UTF-8?B?` / `?=`
  framing; longer values fold onto continuation lines with CRLF + one space.
- **Split on code-point boundaries, never byte boundaries.** Severing a
  multi-byte character across two encoded-words decodes to `�` — a subtler
  version of the same class of bug.
- **Pure-ASCII values pass through unencoded**, so ordinary subjects stay
  human-readable in logs and on the wire.
- **CR/LF is stripped from every header value.** These interpolate
  CRM-sourced text (campus, company, contact name); a newline in that data
  would let the rest be parsed as additional headers — an injected `Bcc:`
  would silently copy a third party on every send.

Tests: `functions/src/sales/__tests__/mimeHeaders.test.ts` (round-trips the
exact incident subject, accented and CJK text, the 75-char limit, the
multi-byte split, and header injection).

## Watch for it elsewhere

Anything building a `raw` message for `gmail.users.messages.send`. Also note
the **copy templates are full of characters that trigger this** — em dashes
throughout, and the campaign footer uses `·`. Subjects are the exposed
surface because bodies are charset-declared, so a template edit that moves a
dash into a subject line reintroduces this instantly unless the helper is
used.

Already-sent mail cannot be corrected; the fix only affects future sends.

Related: [[project_crm_reengagement]], [[project_sodexo_campus_prospecting]].
