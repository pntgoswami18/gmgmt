const pino = require('pino');

const effectiveLevel =
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

const logger = pino({
  level: effectiveLevel,
  transport:
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    effectiveLevel !== 'silent'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

module.exports = logger;
