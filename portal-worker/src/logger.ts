/**
 * Tiny structured logger with secret redaction. Anything registered via
 * `redact()` (portal passwords, Slack token) is scrubbed from every line,
 * including nested error messages, before it reaches stdout.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const redactions = new Set<string>();

export function redact(value: string | null | undefined): void {
  if (value && value.length >= 4) redactions.add(value);
}

function scrub(text: string): string {
  let out = text;
  for (const secret of redactions) out = out.split(secret).join('[redacted]');
  return out;
}

function serialize(meta: unknown): string {
  if (meta === undefined) return '';
  try {
    return scrub(
      JSON.stringify(meta, (_k, v) => {
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack?.split('\n').slice(0, 4) };
        return v;
      }),
    );
  } catch {
    return '[unserializable]';
  }
}

function line(level: Level, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const text = `${ts} ${level.toUpperCase().padEnd(5)} ${scrub(msg)}${meta === undefined ? '' : ' ' + serialize(meta)}`;
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const log = {
  debug: (msg: string, meta?: unknown) => {
    if (process.env.PORTAL_LOG_DEBUG) line('debug', msg, meta);
  },
  info: (msg: string, meta?: unknown) => line('info', msg, meta),
  warn: (msg: string, meta?: unknown) => line('warn', msg, meta),
  error: (msg: string, meta?: unknown) => line('error', msg, meta),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return scrub(err.message);
  return scrub(String(err));
}
