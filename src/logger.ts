let _jsonMode = false;

export function setJsonMode(value: boolean): void {
  _jsonMode = value;
}

export function isJsonMode(): boolean {
  return _jsonMode;
}

interface LogEntry {
  level: "info" | "success" | "warn" | "error";
  message: string;
}

const PREFIXES: Record<LogEntry["level"], string> = {
  info: "ℹ",
  success: "✅",
  warn: "⚠️",
  error: "❌",
};

function emit(entry: LogEntry): void {
  if (_jsonMode) {
    process.stdout.write(JSON.stringify(entry) + "\n");
    return;
  }

  const line = `${PREFIXES[entry.level]} ${entry.message}\n`;

  if (entry.level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const log = {
  info: (message: string) => emit({ level: "info", message }),
  success: (message: string) => emit({ level: "success", message }),
  warn: (message: string) => emit({ level: "warn", message }),
  error: (message: string) => emit({ level: "error", message }),
};
