type LogMethod<Message = unknown> = (message: Message, source?: string, data?: unknown) => void;

type AppLogger<Message = unknown> = {
  flush?: () => Promise<void>;
  debug: LogMethod<Message>;
  info: LogMethod<Message>;
  warn: LogMethod<Message>;
  error: LogMethod<Message>;
  console?: LogMethod<Message>;
  emergency?: LogMethod<Message>;
};

type LogLevel = 'debug' | 'info' | 'console' | 'warn' | 'error' | 'emergency';
type LogThreshold = 'debug' | 'info' | 'warn' | 'error';

export type { AppLogger, LogLevel, LogMethod, LogThreshold };
