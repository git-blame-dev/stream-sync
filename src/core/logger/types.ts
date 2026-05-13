type LogMethod = (message: unknown, source?: string, data?: unknown) => void;

type AppLogger = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  console?: LogMethod;
  emergency?: LogMethod;
};

type LogLevel = 'debug' | 'info' | 'console' | 'warn' | 'error' | 'emergency';
type LogThreshold = 'debug' | 'info' | 'warn' | 'error';

export type { AppLogger, LogLevel, LogMethod, LogThreshold };
