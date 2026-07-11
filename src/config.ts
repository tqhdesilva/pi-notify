import { readFileSync } from "node:fs";

export type ContentMode = "minimal" | "metadata" | "summary";
export type NotificationProtocol = "auto" | "osc777" | "none";

export interface NotifyConfig {
  enabled: boolean;
  notifyOnInput: boolean;
  content: ContentMode;
  protocol: NotificationProtocol;
  nativeFallback: boolean;
  minDurationMs: number;
  summaryMaxBytes: number;
}

export interface SessionOverride {
  enabled: boolean | null;
}

export const DEFAULT_CONFIG: Readonly<NotifyConfig> = Object.freeze({
  enabled: true,
  notifyOnInput: true,
  content: "summary",
  protocol: "auto",
  nativeFallback: true,
  minDurationMs: 0,
  summaryMaxBytes: 160,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(value: unknown): NotifyConfig {
  if (!isRecord(value)) {
    throw new Error("configuration must be a JSON object");
  }

  const config = { ...DEFAULT_CONFIG };

  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") throw new Error("enabled must be a boolean");
    config.enabled = value.enabled;
  }
  if (value.notifyOnInput !== undefined) {
    if (typeof value.notifyOnInput !== "boolean") throw new Error("notifyOnInput must be a boolean");
    config.notifyOnInput = value.notifyOnInput;
  }
  if (value.content !== undefined) {
    if (!(["minimal", "metadata", "summary"] as unknown[]).includes(value.content)) {
      throw new Error('content must be "minimal", "metadata", or "summary"');
    }
    config.content = value.content as ContentMode;
  }
  if (value.protocol !== undefined) {
    if (!(["auto", "osc777", "none"] as unknown[]).includes(value.protocol)) {
      throw new Error('protocol must be "auto", "osc777", or "none"');
    }
    config.protocol = value.protocol as NotificationProtocol;
  }
  if (value.nativeFallback !== undefined) {
    if (typeof value.nativeFallback !== "boolean") throw new Error("nativeFallback must be a boolean");
    config.nativeFallback = value.nativeFallback;
  }
  if (value.minDurationMs !== undefined) {
    if (!Number.isFinite(value.minDurationMs) || (value.minDurationMs as number) < 0) {
      throw new Error("minDurationMs must be a non-negative number");
    }
    config.minDurationMs = value.minDurationMs as number;
  }
  if (value.summaryMaxBytes !== undefined) {
    if (
      !Number.isInteger(value.summaryMaxBytes) ||
      (value.summaryMaxBytes as number) < 32 ||
      (value.summaryMaxBytes as number) > 1024
    ) {
      throw new Error("summaryMaxBytes must be an integer from 32 to 1024");
    }
    config.summaryMaxBytes = value.summaryMaxBytes as number;
  }

  return config;
}

export function loadConfig(path: string): {
  config: NotifyConfig;
  userConfiguredEnabled: boolean;
  error?: string;
} {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return {
      config: parseConfig(value),
      userConfiguredEnabled: isRecord(value) && Object.hasOwn(value, "enabled"),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { config: { ...DEFAULT_CONFIG }, userConfiguredEnabled: false };
    }
    return {
      config: { ...DEFAULT_CONFIG },
      userConfiguredEnabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readLatestSessionOverride(entries: readonly unknown[]): boolean | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== "pi-notify-config") continue;
    const data = entry.data;
    if (!isRecord(data)) continue;
    if (data.enabled === null) return undefined;
    if (typeof data.enabled === "boolean") return data.enabled;
  }
  return undefined;
}

export function resolveEnabled(
  config: NotifyConfig,
  sessionOverride: boolean | undefined,
  userConfiguredEnabled = config.enabled !== DEFAULT_CONFIG.enabled,
): { enabled: boolean; source: "session" | "user" | "built-in" } {
  if (sessionOverride !== undefined) return { enabled: sessionOverride, source: "session" };
  if (userConfiguredEnabled) return { enabled: config.enabled, source: "user" };
  return { enabled: config.enabled, source: "built-in" };
}
