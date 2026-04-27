/**
 * SHA256 source hash for translation deduplication.
 */

import crypto from 'crypto';

export function computeHash(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
