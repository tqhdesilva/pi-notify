import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  loadConfig,
  readLatestSessionOverride,
  resolveEnabled,
  type NotificationProtocol,
  type NotifyConfig,
} from "./config.ts";
import {
  inputNotification,
  notificationContext,
  readyNotification,
  summarizeAssistantText,
} from "./format.ts";
import { deliverNotification, getTmuxContext } from "./transport.ts";

const CONFIG_ENTRY_TYPE = "pi-notify-config";
const VALID_PROTOCOLS = new Set<NotificationProtocol>(["auto", "osc777", "none"]);

function assistantText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const candidate = message as { role?: unknown; content?: unknown };
  if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return "";
  return candidate.content
    .filter((block): block is { type: "text"; text: string } => {
      if (typeof block !== "object" || block === null) return false;
      const value = block as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string";
    })
    .map((block) => block.text)
    .join(" ");
}

function configuredProtocol(config: NotifyConfig, env: NodeJS.ProcessEnv): NotificationProtocol {
  const override = env.PI_NOTIFY_PROTOCOL?.toLowerCase() as NotificationProtocol | undefined;
  return override && VALID_PROTOCOLS.has(override) ? override : config.protocol;
}

export default function piNotify(pi: ExtensionAPI): void {
  let config: NotifyConfig = { ...DEFAULT_CONFIG };
  let userConfiguredEnabled = false;
  let sessionOverride: boolean | undefined;
  let startedAt: number | undefined;
  let latestAssistantText = "";

  const enabledState = () => resolveEnabled(config, sessionOverride, userConfiguredEnabled);

  async function send(
    ctx: ExtensionContext,
    copy: (location?: string) => { title: string; body: string },
  ): Promise<void> {
    if (ctx.mode !== "tui") return;
    const tmux = await getTmuxContext(pi);
    const { title, body } = copy(tmux.location);
    await deliverNotification({
      pi,
      title,
      body,
      tmux,
      protocol: configuredProtocol(config, process.env),
      nativeFallback: config.nativeFallback,
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const loaded = loadConfig(join(getAgentDir(), "pi-notify.json"));
    config = loaded.config;
    userConfiguredEnabled = loaded.userConfiguredEnabled;
    sessionOverride = readLatestSessionOverride(ctx.sessionManager.getEntries());
    startedAt = undefined;
    latestAssistantText = "";

    if (loaded.error && ctx.hasUI) {
      ctx.ui.notify(`pi-notify: invalid config; using defaults (${loaded.error})`, "warning");
    }
  });

  pi.on("agent_start", () => {
    if (startedAt === undefined) {
      startedAt = Date.now();
      latestAssistantText = "";
    }
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      latestAssistantText = assistantText(event.message);
    }
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (
      event.toolName !== "ask_user_question" ||
      !config.notifyOnInput ||
      !enabledState().enabled
    ) {
      return;
    }

    const context = notificationContext(pi.getSessionName(), ctx.cwd);
    await send(ctx, (location) => inputNotification({ context, location, content: config.content }));
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const runStartedAt = startedAt;
    const summarySource = latestAssistantText;
    startedAt = undefined;
    latestAssistantText = "";

    if (!enabledState().enabled || runStartedAt === undefined) return;
    const durationMs = Date.now() - runStartedAt;
    if (durationMs < config.minDurationMs) return;

    const context = notificationContext(pi.getSessionName(), ctx.cwd);
    const summary = config.content === "summary"
      ? summarizeAssistantText(summarySource, config.summaryMaxBytes)
      : undefined;

    await send(ctx, (location) =>
      readyNotification({
        context,
        location,
        durationMs,
        summary,
        content: config.content,
      }),
    );
  });

  pi.registerCommand("notify", {
    description: "Configure notifications for this session (on|off|default|status)",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "default", "status"];
      const matches = options.filter((value) => value.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";

      if (action === "on" || action === "off") {
        sessionOverride = action === "on";
        pi.appendEntry(CONFIG_ENTRY_TYPE, { enabled: sessionOverride });
        ctx.ui.notify(`pi-notify is ${sessionOverride ? "enabled" : "disabled"} for this session`, "info");
        return;
      }

      if (action === "default") {
        sessionOverride = undefined;
        pi.appendEntry(CONFIG_ENTRY_TYPE, { enabled: null });
        const state = enabledState();
        ctx.ui.notify(`pi-notify follows the ${state.source} default (${state.enabled ? "on" : "off"})`, "info");
        return;
      }

      if (action === "status") {
        const state = enabledState();
        ctx.ui.notify(
          `pi-notify: ${state.enabled ? "on" : "off"} (${state.source}); content=${config.content}; protocol=${configuredProtocol(config, process.env)}`,
          "info",
        );
        return;
      }

      ctx.ui.notify("Usage: /notify on|off|default|status", "error");
    },
  });
}

export { assistantText, configuredProtocol };
