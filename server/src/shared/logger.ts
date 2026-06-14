import pino, { type Logger } from 'pino';
import { loadEnv } from '../config/env.js';

let rootLogger: Logger | undefined;

export function getLogger(): Logger {
  if (rootLogger) return rootLogger;
  const env = loadEnv();
  const isDev = env.NODE_ENV !== 'production';
  rootLogger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'chess-app-server' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        '*.password',
        '*.passwordHash',
        '*.password_hash',
      ],
      remove: true,
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,service',
            },
          },
        }
      : {}),
  });
  return rootLogger;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
