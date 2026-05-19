import type { Logger } from '../log.js';

export function silentLogger(): Logger {
  const log: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => log,
  };
  return log;
}

export function makeCapturingLogger(): {
  logger: Logger;
  warns: Array<{ msg: string; fields: Record<string, unknown> }>;
} {
  const warns: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: (msg, fields) => warns.push({ msg, fields: fields ?? {} }),
    error: noop,
    child: () => logger,
  };
  return { logger, warns };
}
