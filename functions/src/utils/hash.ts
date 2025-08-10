import * as crypto from 'crypto';

export function stableHash(input: any): string {
  try {
    const json = JSON.stringify(input, Object.keys(input).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  } catch {
    return crypto.createHash('sha256').update(String(input)).digest('hex');
  }
}


