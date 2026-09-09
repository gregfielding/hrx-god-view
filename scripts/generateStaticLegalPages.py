#!/usr/bin/env python3
"""Generate the static, crawlable legal pages in public/ from the i18n locale copy.

Why: Twilio 10DLC reviewers (and their crawler) must be able to read the Privacy Policy,
Terms, SMS notice and SMS consent WITHOUT JavaScript; the app pages are an SPA shell.
Firebase rewrites serve these at /privacy, /terms, /sms-privacy, /consent.
Run from the repo root after editing i18n/locales/{en,es}.json legal.* copy:
    python3 scripts/generateStaticLegalPages.py
"""
import html
import json
import re

EN = json.load(open('i18n/locales/en.json'))['legal']
ES = json.load(open('i18n/locales/es.json'))['legal']
esc = lambda x: html.escape(str(x))

# Twilio's own example of the sentence their reviewers look for (A2P 10DLC Campaign Onboarding Guide).
TWILIO_SENTENCE = {
    'en': "All the above categories exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties.",
    'es': "Todas las categorías anteriores excluyen los datos de suscripción y consentimiento del originador de mensajes de texto; esta información no se compartirá con ningún tercero.",
}
NONSHARE = {
    'en': EN['privacy'].get('s4P3', ''),
    'es': ES['privacy'].get('s4P3', ''),
}
NAV = ('<nav><strong>C1 Staffing, LLC</strong> · <a href="https://hrxone.com">hrxone.com</a> · '
       '<a href="https://hrxone.com/privacy">Privacy Policy</a> · <a href="https://hrxone.com/terms">Terms and Conditions</a> · '
       '<a href="https://hrxone.com/sms-privacy">SMS Privacy Notice</a> · <a href="https://hrxone.com/consent">SMS Consent Agreement</a> · '
       '<a href="https://hrxone.com/sms-optin.html">SMS opt-in (sign-up screen)</a></nav>')
FOOT = ("© C1 Staffing, LLC and affiliates. Privacy Policy: https://hrxone.com/privacy · Terms and Conditions: https://hrxone.com/terms · "
        "SMS Privacy Notice: https://hrxone.com/sms-privacy · SMS Consent Agreement: https://hrxone.com/consent · "
        "Contact: support@c1staffing.com · privacy@c1staffing.com")


def linkify(t):
    return re.sub(r'(https://hrxone\.com/[a-z\-]+(?:\.html)?|https://hrxone\.com/privacy|https://hrxone\.com)', r'<a href="\1">\1</a>', t)


def shell(title, body, canonical):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)} | C1 Staffing</title><link rel="canonical" href="https://hrxone.com/{canonical}">
<meta name="robots" content="index,follow"><meta name="description" content="{esc(title)} — C1 Staffing, LLC and HRX One (hrxone.com).">
<style>body{{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55;color:#1a1a1a}}h1{{font-size:1.6rem}}h2{{font-size:1.15rem;margin-top:1.6em}}.meta{{color:#555}}footer,nav{{color:#555;font-size:.9rem}}nav{{margin-bottom:1.5em}}hr{{margin:3em 0}}img{{max-width:100%;border:1px solid #ddd}}</style>
</head><body>
{NAV}
{body}
<footer>{linkify(esc(FOOT))}</footer>
</body></html>
"""


def natural_order(sec):
    keys = list(sec.keys()); out = []; i = 0
    while i < len(keys):
        k = keys[i]
        m = re.match(r'(s\d+)L\d+$', k)
        if m:
            grp = []
            while i < len(keys) and re.match(rf'{m.group(1)}L\d+$', keys[i]):
                grp.append(keys[i]); i += 1
            out.append(('ul', grp)); continue
        out.append(k); i += 1
    return out


def render(sec, order):
    out = []
    for item in order:
        if isinstance(item, tuple):
            lis = [f"<li>{esc(sec[k])}</li>" for k in item[1] if k in sec]
            if lis: out.append("<ul>" + "".join(lis) + "</ul>")
        elif item in sec:
            k = item; v = esc(sec[k])
            if k in ('effectiveDate', 'lastUpdated', 'footer') or k.startswith('links') or k.endswith(('Privacy', 'And', 'Consent', 'P1B', 'P1Privacy')):
                continue
            if k == 'title': out.append(f"<h1>{v}</h1>")
            elif k.endswith('Title'): out.append(f"<h2>{v}</h2>")
            else: out.append(f"<p>{linkify(v)}</p>")
    return "\n".join(out)


def sms_terms(lang):
    if lang == 'en':
        return f"""<h2>SMS / Text Messaging Terms and Conditions — program: C1 Staffing employment texts</h2>
<p><strong>Program description:</strong> C1 Staffing, LLC ("C1 Staffing", hrxone.com) sends employment-related, conversational text messages to workers who created an account and opted in: shift offers and confirmations, day-of-shift reminders and on-site check-ins, onboarding and document reminders, and replies from our recruiting team. No marketing or promotional content.</p>
<p><strong>How you opt in:</strong> on the account sign-up form at https://hrxone.com/signup you enter and verify your mobile number and check a separate, unchecked box that reads: "By checking this box, I agree to receive employment-related text messages from C1 Staffing / HRX One… Message and data rates may apply. Message frequency varies. Reply STOP to opt out, or HELP for help. Consent is not a condition of employment." (screenshot: https://hrxone.com/sms-optin.html). Consent is given directly to C1 Staffing and is not a condition of applying for or accepting employment. You can turn text messages on or off at any time from your account dashboard.</p>
<p><strong>Message frequency:</strong> message frequency varies; it may include multiple messages per week during onboarding or scheduled shifts.</p>
<p><strong>Message and data rates may apply.</strong> <strong>Carriers are not liable for any delayed or undelivered messages.</strong></p>
<p><strong>Opt out: reply STOP to any message to stop receiving texts.</strong> You will get one confirmation message. Reply START to opt back in.</p>
<p><strong>Help: reply HELP to any message, or email support@c1staffing.com.</strong></p>
<p><strong>Privacy:</strong> our Privacy Policy is at https://hrxone.com/privacy and our SMS Privacy Notice at https://hrxone.com/sms-privacy. {esc(NONSHARE['en'])} {esc(TWILIO_SENTENCE['en'])}</p>"""
    return f"""<h2>Términos y condiciones de mensajes SMS / de texto — programa: mensajes de empleo de C1 Staffing</h2>
<p><strong>Descripción:</strong> C1 Staffing, LLC (hrxone.com) envía mensajes de texto conversacionales relacionados con el empleo a trabajadores que crearon una cuenta y aceptaron recibirlos: ofertas y confirmaciones de turnos, recordatorios del día del turno y registro de llegada, recordatorios de incorporación y documentos, y respuestas de nuestro equipo de reclutamiento. Sin contenido de marketing ni promocional.</p>
<p><strong>Cómo te suscribes:</strong> en el formulario de creación de cuenta en https://hrxone.com/signup ingresas y verificas tu número de móvil y marcas una casilla separada, sin marcar por defecto, para aceptar mensajes de texto (captura: https://hrxone.com/sms-optin.html). El consentimiento se otorga directamente a C1 Staffing y no es condición para solicitar ni aceptar un empleo. Puedes activar o desactivar los mensajes en cualquier momento desde tu panel de cuenta.</p>
<p><strong>Frecuencia:</strong> varía; puede incluir varios mensajes por semana durante la incorporación o turnos programados.</p>
<p><strong>Pueden aplicarse tarifas de mensajes y datos.</strong> <strong>Los operadores no son responsables de mensajes retrasados o no entregados.</strong></p>
<p><strong>Cancelar: responde STOP a cualquier mensaje para dejar de recibir textos.</strong> Recibirás un mensaje de confirmación. Responde START para volver a suscribirte.</p>
<p><strong>Ayuda: responde HELP a cualquier mensaje o escribe a support@c1staffing.com.</strong></p>
<p><strong>Privacidad:</strong> Política de privacidad: https://hrxone.com/privacy · Aviso de privacidad SMS: https://hrxone.com/sms-privacy. {esc(NONSHARE['es'])} {esc(TWILIO_SENTENCE['es'])}</p>"""


def page(section, canonical, dates):
    parts = []
    for lang, L in (('en', EN), ('es', ES)):
        sec = L[section]
        body = render(sec, natural_order(sec))
        body = body.replace(f"<h1>{esc(sec['title'])}</h1>", f"<h1>{esc(sec['title'])}</h1>\n<p class='meta'>{esc(sec['effectiveDate'])} {dates[0]} · {esc(sec['lastUpdated'])} {dates[1]}</p>", 1)
        if section == 'privacy':
            anchor = f"<p>{linkify(esc(sec['s4P3']))}</p>"
            body = body.replace(anchor, f"<p><strong>{esc(sec['s4P3'])} {esc(TWILIO_SENTENCE[lang])}</strong></p>", 1)
        if section == 'smsPrivacy':
            anchor = f"<p>{linkify(esc(sec['s2P4']))}</p>"
            body = body.replace(anchor, f"<p><strong>{esc(sec['s2P4'])} {esc(TWILIO_SENTENCE[lang])}</strong></p>", 1)
        if section == 'terms':
            body += "\n" + sms_terms(lang)
        if section == 'consent':
            body += ("\n<h2>How opt-in works (for carriers and reviewers)</h2><p>Workers opt in on the account sign-up form at https://hrxone.com/signup: they enter and verify their mobile phone number, then check a separate, unchecked box labeled \"By checking this box, I agree to receive employment-related text messages from C1 Staffing / HRX One… Message and data rates may apply. Message frequency varies. Reply STOP to opt out, or HELP for help. Consent is not a condition of employment.\" A screenshot of that screen is published at https://hrxone.com/sms-optin.html. Consent is not a condition of employment; workers can turn texts on or off any time from their account dashboard.</p>"
                     if lang == 'en' else "\n<h2>Cómo funciona la suscripción</h2><p>Los trabajadores se suscriben en el formulario de creación de cuenta en https://hrxone.com/signup: ingresan y verifican su número de móvil y marcan una casilla separada, sin marcar por defecto. Captura de pantalla: https://hrxone.com/sms-optin.html.</p>")
        parts.append(("<p class='meta'>Español</p>\n" if lang == 'es' else "") + body)
    return shell(EN[section]['title'], "\n<hr>\n".join(parts), canonical)


for section, fname, dates in (
    ('privacy', 'privacy.html', ('October 21, 2025', 'September 9, 2026')),
    ('terms', 'terms.html', ('October 21, 2025', 'September 9, 2026')),
    ('smsPrivacy', 'sms-privacy.html', ('October 21, 2025', 'September 9, 2026')),
    ('consent', 'consent.html', ('October 21, 2025', 'September 9, 2026')),
):
    out = page(section, fname, dates)
    open(f'public/{fname}', 'w').write(out)
    print(fname, len(out), 'bytes | twilio sentence:', out.count('exclude text messaging originator'), '| STOP:', out.count('STOP'))
