type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function shouldDebug(): boolean {
  try {
    return process.env.NODE_ENV === 'development' && localStorage.getItem('debug') === '1';
  } catch {
    return process.env.NODE_ENV === 'development';
  }
}

function write(level: LogLevel, ...args: any[]) {
  // Always log errors; others gated by shouldDebug
  if (level !== 'error' && !shouldDebug()) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  switch (level) {
    case 'debug':
    case 'info':
      // eslint-disable-next-line no-console
      console.log(prefix, ...args);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(prefix, ...args);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(prefix, ...args);
      break;
  }
}

export const logger = {
  debug: (...args: any[]) => write('debug', ...args),
  info: (...args: any[]) => write('info', ...args),
  warn: (...args: any[]) => write('warn', ...args),
  error: (...args: any[]) => write('error', ...args),
};

export default logger;


