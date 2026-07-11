import { closeSync, openSync, writeSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotificationProtocol } from "./config.ts";
import { sanitizeNotificationText } from "./format.ts";

const OSC777_PREFIX = "\u001b]777;notify;";
const STRING_TERMINATOR = "\u001b\\";
const OSA_SCRIPT = [
  "on run argv",
  "display notification (item 2 of argv) with title (item 1 of argv)",
  "end run",
].join("\n");

export interface TmuxContext {
  insideTmux: boolean;
  pane?: string;
  location?: string;
  attached?: boolean;
  clientTermname?: string;
}

export interface DeliveryPlan {
  bell: boolean;
  terminalPayload?: string;
  native: boolean;
}

export function encodeOsc777(title: string, body: string): string {
  const safeTitle = sanitizeNotificationText(title, 160);
  const safeBody = sanitizeNotificationText(body, 512);
  return `${OSC777_PREFIX}${safeTitle};${safeBody}\u0007`;
}

export function wrapForTmux(payload: string): string {
  return `\u001bPtmux;${payload.replaceAll("\u001b", "\u001b\u001b")}${STRING_TERMINATOR}`;
}

export function supportsOsc777(env: NodeJS.ProcessEnv, clientTermname?: string): boolean {
  const signals = [
    env.TERM,
    env.TERM_PROGRAM,
    env.GHOSTTY_RESOURCES_DIR ? "ghostty" : undefined,
    env.WEZTERM_PANE ? "wezterm" : undefined,
    clientTermname,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return signals.includes("ghostty") || signals.includes("wezterm");
}

export function planDelivery(options: {
  tmux: TmuxContext;
  protocol: NotificationProtocol;
  nativeFallback: boolean;
  platform: NodeJS.Platform;
  oscSupported: boolean;
  oscPayload: string;
}): DeliveryPlan {
  const { tmux } = options;
  const useOsc = options.protocol === "osc777" || (options.protocol === "auto" && options.oscSupported);
  const canReachTerminal = !tmux.insideTmux || tmux.attached !== false;
  const terminalPayload = useOsc && canReachTerminal
    ? tmux.insideTmux
      ? wrapForTmux(options.oscPayload)
      : options.oscPayload
    : undefined;

  return {
    bell: tmux.insideTmux,
    terminalPayload,
    native:
      tmux.insideTmux &&
      tmux.attached === false &&
      options.nativeFallback &&
      options.platform === "darwin",
  };
}

export async function getTmuxContext(
  pi: Pick<ExtensionAPI, "exec">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TmuxContext> {
  const pane = env.TMUX_PANE;
  if (!env.TMUX || !pane) return { insideTmux: false };

  const format = "#{session_name}:#{window_index}.#{pane_index}\t#{session_attached}\t#{client_termname}";
  try {
    const result = await pi.exec("tmux", ["display-message", "-p", "-t", pane, format], { timeout: 2000 });
    if (result.code !== 0) return { insideTmux: true, pane };
    const [rawLocation, rawAttached, rawClientTermname] = result.stdout.trim().split("\t");
    return {
      insideTmux: true,
      pane,
      location: sanitizeNotificationText(rawLocation, 128) || undefined,
      attached: /^\d+$/u.test(rawAttached ?? "") ? Number(rawAttached) > 0 : undefined,
      clientTermname: sanitizeNotificationText(rawClientTermname, 64) || undefined,
    };
  } catch {
    return { insideTmux: true, pane };
  }
}

export function writeTerminal(data: string): boolean {
  try {
    const fd = openSync("/dev/tty", "w");
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    if (process.stdout.isTTY) {
      process.stdout.write(data);
      return true;
    }
    return false;
  }
}

export async function deliverNotification(options: {
  pi: Pick<ExtensionAPI, "exec">;
  title: string;
  body: string;
  tmux: TmuxContext;
  protocol: NotificationProtocol;
  nativeFallback: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  terminalWriter?: (data: string) => boolean;
}): Promise<DeliveryPlan> {
  const env = options.env ?? process.env;
  const oscPayload = encodeOsc777(options.title, options.body);
  const plan = planDelivery({
    tmux: options.tmux,
    protocol: options.protocol,
    nativeFallback: options.nativeFallback,
    platform: options.platform ?? process.platform,
    oscSupported: supportsOsc777(env, options.tmux.clientTermname),
    oscPayload,
  });

  const terminalData = `${plan.bell ? "\u0007" : ""}${plan.terminalPayload ?? ""}`;
  if (terminalData) (options.terminalWriter ?? writeTerminal)(terminalData);

  if (plan.native) {
    await options.pi.exec("/usr/bin/osascript", ["-e", OSA_SCRIPT, options.title, options.body], { timeout: 5000 });
  }

  return plan;
}
