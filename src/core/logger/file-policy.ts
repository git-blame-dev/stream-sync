// Shared defaults for composition, schema and standalone file writers.
export const FILE_LOG_LIMITS = { maxBytes: 20 * 1024 * 1024, maxQueueBytes: 2 * 1024 * 1024 };
export const OPERATIONAL_RETENTION = { archiveMaxBytes: 100 * 1024 * 1024, archiveMaxAgeDays: 14 };
export const RAW_RETENTION = { archiveMaxBytes: 100 * 1024 * 1024, archiveMaxAgeDays: 2 };
