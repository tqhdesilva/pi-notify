import { basename } from "node:path";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/gu;
const MARKDOWN_DECORATION = /(?:```|`|\*\*|__|~~)/gu;

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  const ellipsis = "…";
  const ellipsisBytes = Buffer.byteLength(ellipsis, "utf8");
  if (maxBytes < ellipsisBytes) return "";

  let result = "";
  let bytes = 0;
  const available = maxBytes - ellipsisBytes;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > available) break;
    result += character;
    bytes += characterBytes;
  }
  return `${result}${ellipsis}`;
}

export function sanitizeNotificationText(value: unknown, maxBytes = 512): string {
  const sanitized = String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replaceAll(";", ",")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateUtf8(sanitized, maxBytes);
}

export function summarizeAssistantText(value: string, maxBytes: number): string {
  const plain = sanitizeNotificationText(
    value
      .replace(MARKDOWN_DECORATION, "")
      .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/gmu, ""),
    Math.max(maxBytes * 4, maxBytes),
  );
  if (!plain) return "";

  let sentence = plain;
  try {
    const segment = new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(plain)[Symbol.iterator]().next();
    if (!segment.done) sentence = segment.value.segment.trim();
  } catch {
    const match = plain.match(/^.*?[.!?](?:\s|$)/u);
    if (match) sentence = match[0].trim();
  }

  return truncateUtf8(sentence, maxBytes);
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function notificationContext(sessionName: string | undefined, cwd: string): string {
  const context = sessionName?.trim() || basename(cwd) || "Pi";
  return sanitizeNotificationText(context, 96) || "Pi";
}

export interface NotificationCopyOptions {
  context: string;
  location?: string;
  durationMs?: number;
  summary?: string;
  content: "minimal" | "metadata" | "summary";
}

export function readyNotification(options: NotificationCopyOptions): { title: string; body: string } {
  const title = sanitizeNotificationText(`Pi ready · ${options.context}`, 160);
  const details: string[] = [];

  if (options.content !== "minimal" && options.location) details.push(`tmux ${options.location}`);
  if (options.content === "summary" && options.summary) details.push(options.summary);
  if (options.content !== "minimal" && options.durationMs !== undefined) {
    details.push(`finished in ${formatDuration(options.durationMs)}`);
  }

  return {
    title,
    body: sanitizeNotificationText(details.join(" · ") || "Ready for input", 512),
  };
}

export function inputNotification(options: Omit<NotificationCopyOptions, "durationMs" | "summary">): {
  title: string;
  body: string;
} {
  const title = sanitizeNotificationText(`Pi needs input · ${options.context}`, 160);
  const details = options.content !== "minimal" && options.location ? [`tmux ${options.location}`] : [];
  details.push("choose an option");
  return { title, body: sanitizeNotificationText(details.join(" · "), 512) };
}
