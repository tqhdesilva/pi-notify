import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deliverNotification, getTmuxContext } = vi.hoisted(() => ({
  deliverNotification: vi.fn().mockResolvedValue({ bell: false, native: false }),
  getTmuxContext: vi.fn().mockResolvedValue({
    insideTmux: true,
    attached: true,
    location: "work:2.1",
    clientTermname: "xterm-ghostty",
  }),
}));

vi.mock("../src/transport.ts", () => ({ deliverNotification, getTmuxContext }));

import piNotify from "../src/index.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const entries: Array<{ type: string; data: unknown }> = [];
  const pi = {
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
    registerCommand: vi.fn((name: string, command: { handler: Handler }) => commands.set(name, command)),
    getSessionName: vi.fn(() => "dotfiles"),
    appendEntry: vi.fn((type: string, data: unknown) => entries.push({ type, data })),
    exec: vi.fn(),
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui",
    cwd: "/Users/test/dotfiles",
    hasUI: true,
    sessionManager: { getEntries: () => [] },
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
  piNotify(pi);
  return { handlers, commands, entries, ctx };
}

describe("pi-notify extension", () => {
  beforeEach(() => {
    deliverNotification.mockClear();
    getTmuxContext.mockClear();
    vi.useRealTimers();
  });

  it("notifies once after an agent run fully settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T10:00:00Z"));
    const { handlers, ctx } = harness();

    await handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
    vi.setSystemTime(new Date("2026-07-10T10:01:42Z"));
    await handlers.get("message_end")?.(
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Implemented the extension. More detail." }] },
      },
      ctx,
    );
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
    await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pi ready · dotfiles",
        body: "tmux work:2.1 · Implemented the extension. · finished in 1m 42s",
      }),
    );
  });

  it("notifies when ask_user_question starts without exposing its arguments", async () => {
    const { handlers, ctx } = harness();
    await handlers.get("tool_execution_start")?.(
      {
        type: "tool_execution_start",
        toolName: "ask_user_question",
        args: { question: "A secret question" },
      },
      ctx,
    );
    expect(deliverNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pi needs input · dotfiles",
        body: "tmux work:2.1 · choose an option",
      }),
    );
    expect(JSON.stringify(deliverNotification.mock.calls)).not.toContain("secret");
  });

  it("persists explicit session enablement commands and tombstones", async () => {
    const { commands, entries, ctx } = harness();
    const command = commands.get("notify");
    await command?.handler("off", ctx);
    await command?.handler("default", ctx);
    expect(entries).toEqual([
      { type: "pi-notify-config", data: { enabled: false } },
      { type: "pi-notify-config", data: { enabled: null } },
    ]);
  });
});
