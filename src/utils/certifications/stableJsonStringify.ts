/**
 * Deterministic JSON serialization: sorted object keys recursively, no timestamps.
 * Used for manifest output identity checks.
 */
export function stableJsonStringify(value: unknown): string {
  return `${stableStringifyValue(value, 2)}\n`;
}

function stableStringifyValue(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((v) => `${innerPad}${stableStringifyValue(v, indent + 2)}`);
    return `[\n${parts.join(',\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    if (keys.length === 0) return '{}';
    const lines = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${innerPad}${JSON.stringify(k)}: ${stableStringifyValue(v, indent + 2)}`;
    });
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}
