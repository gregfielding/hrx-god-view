/**
 * Renders plain text with embedded URLs and phone numbers converted to
 * live links — URLs open in a new tab, phone numbers become `tel:` links.
 * Preserves whitespace/newlines (the caller wraps in a pre-wrap container,
 * or this component's default does).
 *
 * Used on the worker assignment-details page so the Staff Instructions
 * blocks (First Day / Parking / Check-In) have tappable maps links and
 * click-to-call phone numbers instead of inert text.
 */

import React from 'react';
import { Link, Typography } from '@mui/material';
import type { TypographyProps } from '@mui/material';

// One regex, four alternatives, in priority order:
//   1. http(s):// URL
//   2. bare www. URL
//   3. bare domain WITH a path — e.g. "maps.app.goo.gl/CSKHz…",
//      "maps.apple/p/abc". Requires a trailing "/path" so we don't
//      linkify sentence fragments like "Main St." or "Grand Blvd.".
//   4. US phone number (optional +1, area code, 7 digits, separators)
// Mirrors the server-side linkifier in messaging/assignmentDetailsEmail.ts.
const URL_OR_PHONE_REGEX =
  /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']*|(?:\+?1[-.\s])?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}\b)/gi;

/** A fully-matched US phone number (vs. a URL). */
function isPhone(token: string): boolean {
  return /^(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}$/.test(token.trim());
}

/** Strip a US phone string to a tel:-safe value (keep leading + if present). */
function toTelHref(token: string): string {
  const trimmed = token.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  // Ensure a single leading + at most.
  return `tel:${digits.replace(/(?!^)\+/g, '')}`;
}

export interface LinkifiedTextProps {
  text: string;
  /** Typography variant + color for the surrounding text. */
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  /** Extra sx for the wrapping Typography. */
  sx?: TypographyProps['sx'];
}

const LinkifiedText: React.FC<LinkifiedTextProps> = ({
  text,
  variant = 'body2',
  color = 'text.secondary',
  sx,
}) => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Reset lastIndex defensively (regex is module-level + global).
  URL_OR_PHONE_REGEX.lastIndex = 0;

  let key = 0;
  while ((match = URL_OR_PHONE_REGEX.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(<React.Fragment key={key++}>{text.slice(lastIndex, start)}</React.Fragment>);
    }
    if (isPhone(token)) {
      nodes.push(
        <Link key={key++} href={toTelHref(token)} sx={{ whiteSpace: 'nowrap' }}>
          {token}
        </Link>,
      );
    } else {
      // URL — http(s), www., or a bare domain-with-path. Prepend https://
      // when there's no scheme so the link is absolute.
      const href = /^https?:\/\//i.test(token) ? token : `https://${token}`;
      nodes.push(
        <Link
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ wordBreak: 'break-word' }}
        >
          {token}
        </Link>,
      );
    }
    lastIndex = start + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<React.Fragment key={key++}>{text.slice(lastIndex)}</React.Fragment>);
  }

  return (
    <Typography variant={variant} color={color} sx={{ whiteSpace: 'pre-wrap', ...sx }}>
      {nodes}
    </Typography>
  );
};

export default LinkifiedText;
