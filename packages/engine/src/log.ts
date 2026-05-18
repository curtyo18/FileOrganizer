type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  write: (line: string) => void;
  context?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOptions): Logger {
  const base = opts.context ?? {};
  const min = LEVEL_ORDER[opts.level];
  const log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < min) return;
    // Spread order: fields and base first so caller-supplied keys cannot
    // override the canonical ts/level/msg fields.
    const line = JSON.stringify({
      ...fields,
      ...base,
      ts: new Date().toISOString(),
      level,
      msg,
    });
    opts.write(line);
  };
  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (context) =>
      createLogger({ level: opts.level, write: opts.write, context: { ...base, ...context } }),
  };
}

export function defaultWriter(line: string): void {
  process.stderr.write(line + '\n');
}
