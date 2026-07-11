import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  parseConfig,
  readLatestSessionOverride,
  resolveEnabled,
} from "../src/config.ts";

describe("configuration", () => {
  it("applies built-in defaults and valid overrides", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ enabled: false, content: "metadata", minDurationMs: 10_000 })).toMatchObject({
      enabled: false,
      content: "metadata",
      minDurationMs: 10_000,
    });
  });

  it("rejects invalid values", () => {
    expect(() => parseConfig({ enabled: "yes" })).toThrow("enabled must be a boolean");
    expect(() => parseConfig({ protocol: "osc99" })).toThrow("protocol must be");
    expect(() => parseConfig({ summaryMaxBytes: 8 })).toThrow("32 to 1024");
  });

  it("uses the latest whole-session override and honors tombstones", () => {
    const entries = [
      { type: "custom", customType: "pi-notify-config", data: { enabled: false } },
      { type: "message" },
      { type: "custom", customType: "pi-notify-config", data: { enabled: true } },
    ];
    expect(readLatestSessionOverride(entries)).toBe(true);
    expect(
      readLatestSessionOverride([
        ...entries,
        { type: "custom", customType: "pi-notify-config", data: { enabled: null } },
      ]),
    ).toBeUndefined();
  });

  it("reports configuration precedence", () => {
    expect(resolveEnabled({ ...DEFAULT_CONFIG }, false, true)).toEqual({ enabled: false, source: "session" });
    expect(resolveEnabled({ ...DEFAULT_CONFIG, enabled: false }, undefined, true)).toEqual({
      enabled: false,
      source: "user",
    });
    expect(resolveEnabled({ ...DEFAULT_CONFIG }, undefined, false)).toEqual({
      enabled: true,
      source: "built-in",
    });
  });
});
