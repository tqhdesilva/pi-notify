import { describe, expect, it, vi } from "vitest";
import {
  deliverNotification,
  encodeOsc777,
  getTmuxContext,
  planDelivery,
  supportsOsc777,
  wrapForTmux,
} from "../src/transport.ts";

describe("terminal transport", () => {
  it("encodes safe OSC 777 title and body fields", () => {
    expect(encodeOsc777("Pi;ready\u001b", "line 1\nline;2\u0007")).toBe(
      "\u001b]777;notify;Pi,ready;line 1 line,2\u0007",
    );
  });

  it("wraps OSC for tmux and doubles embedded escapes", () => {
    const osc = "\u001b]777;notify;Pi;Ready\u0007";
    expect(wrapForTmux(osc)).toBe("\u001bPtmux;\u001b\u001b]777;notify;Pi;Ready\u0007\u001b\\");
  });

  it("detects Ghostty and WezTerm without trusting tmux TERM alone", () => {
    expect(supportsOsc777({ TERM: "xterm-ghostty" })).toBe(true);
    expect(supportsOsc777({ TERM: "tmux-256color", GHOSTTY_RESOURCES_DIR: "/tmp" })).toBe(true);
    expect(supportsOsc777({ TERM: "tmux-256color" }, "xterm-ghostty")).toBe(true);
    expect(supportsOsc777({ TERM: "xterm-256color" })).toBe(false);
  });

  it("uses wrapped OSC plus BEL for an attached tmux session", () => {
    const plan = planDelivery({
      tmux: { insideTmux: true, attached: true },
      protocol: "auto",
      nativeFallback: true,
      platform: "darwin",
      oscSupported: true,
      oscPayload: "OSC",
    });
    expect(plan).toEqual({ bell: true, terminalPayload: wrapForTmux("OSC"), native: false });
  });

  it("uses BEL and native macOS fallback for a detached tmux session", () => {
    const plan = planDelivery({
      tmux: { insideTmux: true, attached: false },
      protocol: "auto",
      nativeFallback: true,
      platform: "darwin",
      oscSupported: true,
      oscPayload: "OSC",
    });
    expect(plan).toEqual({ bell: true, terminalPayload: undefined, native: true });
  });

  it("queries tmux metadata for the originating pane", async () => {
    const exec = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "work:2.1\t1\txterm-ghostty\n",
      stderr: "",
      killed: false,
    });
    const context = await getTmuxContext({ exec } as never, { TMUX: "/tmp/tmux", TMUX_PANE: "%7" });
    expect(exec).toHaveBeenCalledWith(
      "tmux",
      ["display-message", "-p", "-t", "%7", expect.any(String)],
      { timeout: 2000 },
    );
    expect(context).toEqual({
      insideTmux: true,
      pane: "%7",
      location: "work:2.1",
      attached: true,
      clientTermname: "xterm-ghostty",
    });
  });

  it("passes native notification text as osascript argv", async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "", killed: false });
    const writes: string[] = [];
    const plan = await deliverNotification({
      pi: { exec } as never,
      title: "Pi ready",
      body: "tmux detached:0.0",
      tmux: { insideTmux: true, attached: false },
      protocol: "auto",
      nativeFallback: true,
      platform: "darwin",
      env: { GHOSTTY_RESOURCES_DIR: "/tmp" },
      terminalWriter: (data) => {
        writes.push(data);
        return true;
      },
    });
    expect(plan.native).toBe(true);
    expect(writes).toEqual(["\u0007"]);
    expect(exec).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", expect.any(String), "Pi ready", "tmux detached:0.0"],
      { timeout: 5000 },
    );
  });
});
