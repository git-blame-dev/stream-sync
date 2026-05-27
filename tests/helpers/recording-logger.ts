import type { AppLogger, LogMethod } from "../../src/core/logger/types";

type RecordedLogEntry = {
  level: string;
  message: string;
  source?: string;
  data?: unknown;
};

type RecordingLogger = AppLogger & {
  entries: RecordedLogEntry[];
};

function createRecordingLogger(): RecordingLogger {
  const entries: RecordedLogEntry[] = [];
  const record =
    (level: string): LogMethod =>
    (message: unknown, source?: string, data?: unknown): void => {
      const entry: RecordedLogEntry = { level, message: String(message), data };

      if (source !== undefined) {
        entry.source = source;
      }

      entries.push(entry);
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
