import type { Logger, RuntimeContext } from "@/types";

export function createLogger(context: RuntimeContext): Logger {
  const prefix = `[Switchboard:${context}]`;

  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
