import { buildMimeMessage } from '../mimeHeaders';
import { composeEmailWithSignature, htmlToPlainText, plainTextToHtml } from '../gmailSignature';

// Shape of a real Gmail sendAs signature (logo image + table layout).
const GMAIL_SIG =
  '<table cellpadding="0"><tbody><tr><td><img src="https://ci3.googleusercontent.com/logo.png" width="96" alt="C1 Staffing"></td>' +
  '<td><b>Deborah Waltermyer</b><br>National Recruiter<br><a href="tel:7143716566">714-371-6566</a>&nbsp;(M)<br>' +
  '<a href="mailto:d.waltermyer@c1staffing.com">d.waltermyer@c1staffing.com</a><br>' +
  '<a href="http://www.c1staffing.com">www.c1staffing.com</a></td></tr></tbody></table>';

describe('plainTextToHtml', () => {
  it('escapes and keeps line breaks', () => {
    expect(plainTextToHtml('Hi <Sarah> & team,\n\nThank you!')).toBe('Hi &lt;Sarah&gt; &amp; team,<br><br>Thank you!');
  });
});

describe('htmlToPlainText', () => {
  it('turns a Gmail signature into readable lines', () => {
    expect(htmlToPlainText(GMAIL_SIG)).toBe(
      'Deborah Waltermyer\nNational Recruiter\n714-371-6566 (M)\nd.waltermyer@c1staffing.com\nwww.c1staffing.com',
    );
  });
  it('decodes entities and drops scripts/styles', () => {
    expect(htmlToPlainText('<style>.x{}</style>A&amp;B&#39;s &#x2014; ok<script>alert(1)</script>')).toBe("A&B's — ok");
  });
});

describe('composeEmailWithSignature', () => {
  it('appends the real signature to both alternatives, Gmail-style', () => {
    const out = composeEmailWithSignature('Hi Michael,\n\nThank you!\n', GMAIL_SIG);
    expect(out.html).toBe(
      '<div dir="ltr">Hi Michael,<br><br>Thank you!<br><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">' +
        GMAIL_SIG +
        '</div></div>',
    );
    expect(out.text).toBe('Hi Michael,\n\nThank you!\n\nDeborah Waltermyer\nNational Recruiter\n714-371-6566 (M)\nd.waltermyer@c1staffing.com\nwww.c1staffing.com');
  });
  it('works without a signature', () => {
    expect(composeEmailWithSignature('Hi', null)).toEqual({ text: 'Hi', html: '<div dir="ltr">Hi</div>' });
  });
});

describe('buildMimeMessage multipart/alternative', () => {
  const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const partBody = (msg: string, boundary: string, type: string) => {
    const part = msg.split(`--${boundary}`).find((p) => p.includes(`Content-Type: ${type};`))!;
    return Buffer.from(part.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  };

  it('emits text + html parts that round-trip, with lines under the RFC limit', () => {
    const html = '<div dir="ltr">Hi Michael — thanks!<br><br>' + GMAIL_SIG.repeat(20) + '</div>';
    const msg = decode(buildMimeMessage({ fromName: 'Deborah Waltermyer', fromEmail: 'd.waltermyer@c1staffing.com', to: 'm@sodexo.com', subject: 'Hi', body: 'Hi Michael — thanks!', html }));
    const boundary = /boundary="([^"]+)"/.exec(msg)![1];
    expect(msg).toContain('MIME-Version: 1.0\r\nContent-Type: multipart/alternative;');
    expect(partBody(msg, boundary, 'text/plain')).toBe('Hi Michael — thanks!');
    expect(partBody(msg, boundary, 'text/html')).toBe(html);
    expect(msg.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(Math.max(...msg.split('\r\n').map((l) => l.length))).toBeLessThanOrEqual(998);
  });

  it('leaves plain-text messages unchanged when no html is given', () => {
    const msg = decode(buildMimeMessage({ to: 'm@sodexo.com', subject: 'Hi', body: 'x' }));
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit');
    expect(msg).not.toContain('multipart');
  });
});
