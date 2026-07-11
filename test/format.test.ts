import { describe, expect, it } from "vitest";
import {
  formatDuration,
  inputNotification,
  readyNotification,
  sanitizeNotificationText,
  summarizeAssistantText,
  truncateUtf8,
} from "../src/format.ts";

describe("notification formatting", () => {
  it("removes controls, newlines, and OSC 777 separators", () => {
    const result = sanitizeNotificationText("hello\u001b]9;bad\u0007\nworld\u0085;done");
    expect(result).toBe("hello ]9,bad world ,done");
    expect(result).not.toMatch(/[\u0000-\u001f\u007f-\u009f;]/u);
  });

  it("truncates by UTF-8 bytes without splitting code points", () => {
    const result = truncateUtf8("ab😀cd", 7);
    expect(result).toBe("ab…");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(7);
  });

  it("builds a sanitized first-sentence assistant summary", () => {
    expect(summarizeAssistantText("**Done.**\nThe secret second sentence stays out.", 160)).toBe("Done.");
    const result = summarizeAssistantText(`Result ${"😀".repeat(100)}`, 40);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(40);
  });

  it("formats elapsed time", () => {
    expect(formatDuration(400)).toBe("0s");
    expect(formatDuration(102_000)).toBe("1m 42s");
  });

  it("includes contextual metadata and summary for completion", () => {
    expect(
      readyNotification({
        context: "dotfiles",
        location: "work:2.1",
        durationMs: 102_000,
        summary: "Updated the tmux configuration.",
        content: "summary",
      }),
    ).toEqual({
      title: "Pi ready · dotfiles",
      body: "tmux work:2.1 · Updated the tmux configuration. · finished in 1m 42s",
    });
  });

  it("does not expose tool input in input-request notifications", () => {
    expect(inputNotification({ context: "dotfiles", location: "work:2.1", content: "summary" })).toEqual({
      title: "Pi needs input · dotfiles",
      body: "tmux work:2.1 · choose an option",
    });
  });
});
