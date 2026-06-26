import pino from "pino";

export function createLogger(options = {}) {
  return pino({
    level: options.level || "info",
    transport: options.prettyPrint
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard"
          }
        }
      : undefined
  });
}
