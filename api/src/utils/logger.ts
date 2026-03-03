import pino from "pino";

/**
 * Structured JSON logger (L-2 remediation)
 * Uses pino for high-performance JSON logging with proper log levels.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
