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
