/**
 * Placeholder extraction and parity check (must preserve {{x}}, {x}, %s, URLs, etc.).
 */

const PLACEHOLDER_REGEX = /{{[^}]*}}|{[^}]*}|%s/g;

export function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_REGEX) ?? [];
}

export function placeholdersMatch(source: string, translated: string): boolean {
  const a = extractPlaceholders(source).sort();
  const b = extractPlaceholders(translated).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}
