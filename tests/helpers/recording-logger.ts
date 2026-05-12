type RecordedLogEntry = {
  level: string;
  message: string;
  context?: string;
  payload?: unknown;
};

type RecordingLogger = {
  entries: RecordedLogEntry[];
  debug: (message: string, context?: string, payload?: unknown) => void;
  info: (message: string, context?: string, payload?: unknown) => void;
  warn: (message: string, context?: string, payload?: unknown) => void;
  error: (message: string, context?: string, payload?: unknown) => void;
  console: (message: string, context?: string, payload?: unknown) => void;
};

function createRecordingLogger(): RecordingLogger {
  const entries: RecordedLogEntry[] = [];
  const record =
    (level: string) =>
    (message: string, context?: string, payload?: unknown): void => {
      entries.push({ level, message, context, payload });
    };

  return {
    entries,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    console: record("console"),
  };
}

export { createRecordingLogger, type RecordedLogEntry, type RecordingLogger };
