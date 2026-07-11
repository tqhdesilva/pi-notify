# pi-notify

A standalone [Pi](https://github.com/earendil-works/pi) extension that makes completed work and input requests visible outside the originating terminal pane.

## Behavior

- Notifies when `agent_settled` fires, after retries, compaction, and queued continuations are finished.
- Notifies when the `ask_user_question` tool starts and Pi is waiting for a choice.
- Includes the Pi session name (or project directory), tmux location, elapsed time, and a sanitized first-sentence assistant summary.
- Emits a separate `BEL` inside tmux so the originating window retains its native bell alert.
- Sends OSC 777 through tmux passthrough when the session is attached to Ghostty or WezTerm.
- Uses macOS `osascript` when the originating tmux session is fully detached.
- Skips notification output in Pi print, JSON, and RPC modes.

Ghostty decides whether to display a banner while its window is focused. The extension still emits the notification sequence.

> [!WARNING]
> The default `summary` content mode includes sanitized assistant-generated text. Notification Center and lock-screen previews may expose project details. Set `"content": "metadata"` to omit model output.

## Try it locally

From this repository:

```sh
pi -e ./src/index.ts
```

For tmux notifications from inactive windows, tmux 3.3 or newer needs:

```tmux
set -g allow-passthrough all
set -g monitor-bell on
set -g visual-bell off
set -g window-status-bell-style fg=#cb4b16,bold
```

Reload tmux configuration after changing it. `allow-passthrough on` permits only visible panes; `all` is required for an inactive window to reach an attached terminal client.

## Install

Install this checkout as a user-level Pi package:

```sh
pi install git:github.com/tqhdesilva/pi-notify
```

Pi records the local path in `~/.pi/agent/settings.json`. Use `/reload` in an existing Pi session or start a new session afterward.

## Commands

The setting applies to both desktop delivery and the tmux bell:

```text
/notify on       Enable notifications for this Pi session
/notify off      Disable notifications for this Pi session
/notify default  Follow the user default
/notify status   Show the effective setting, source, content mode, and protocol
```

Session overrides are persisted in the Pi session file and apply across `/tree` branches. `/notify default` appends a tombstone rather than deleting prior entries.

## Configuration

Create `~/.pi/agent/pi-notify.json` to override built-in defaults:

```json
{
  "enabled": true,
  "notifyOnInput": true,
  "content": "summary",
  "protocol": "auto",
  "nativeFallback": true,
  "minDurationMs": 0,
  "summaryMaxBytes": 160
}
```

| Setting           | Values                           |   Default | Purpose                                                                           |
| ----------------- | -------------------------------- | --------: | --------------------------------------------------------------------------------- |
| `enabled`         | boolean                          |    `true` | User-level default. A session override takes precedence.                          |
| `notifyOnInput`   | boolean                          |    `true` | Notify when `ask_user_question` begins.                                           |
| `content`         | `minimal`, `metadata`, `summary` | `summary` | Select notification body detail.                                                  |
| `protocol`        | `auto`, `osc777`, `none`         |    `auto` | Detect OSC 777 support, force it, or disable terminal desktop delivery.           |
| `nativeFallback`  | boolean                          |    `true` | Use `osascript` for a detached tmux session on macOS.                             |
| `minDurationMs`   | non-negative number              |       `0` | Suppress completion notifications for shorter runs. Input requests are immediate. |
| `summaryMaxBytes` | integer 32–1024                  |     `160` | UTF-8 byte limit for assistant summaries.                                         |

Set `PI_NOTIFY_PROTOCOL=osc777` to force OSC 777 for an environment not detected as Ghostty or WezTerm. `none` disables OSC output but does not disable the configured detached macOS fallback.

Invalid configuration is ignored as a whole, Pi shows a warning, and built-in defaults are used.

## Notification safety

Before title or body text enters an OSC sequence, pi-notify:

- replaces C0 and C1 controls, including `ESC`, `BEL`, and newlines;
- replaces OSC 777 semicolon delimiters;
- collapses whitespace;
- truncates at a UTF-8 byte boundary.

Input-request notifications never include tool arguments. In `summary` mode, completion notifications use only the first sentence from the latest assistant text.

## Detached tmux sessions

A detached tmux session has no terminal client, so OSC cannot reach Ghostty. pi-notify therefore:

1. emits `BEL`, allowing tmux to retain the originating window alert;
2. checks `#{session_attached}` for `TMUX_PANE`;
3. sends wrapped OSC 777 when attached;
4. invokes `/usr/bin/osascript` when detached on macOS and `nativeFallback` is enabled.

The native notification includes `session:window.pane`, but clicking it cannot select the originating tmux window automatically.

## Development

```sh
npm install
npm run check
```

The test suite covers configuration precedence, sanitization, UTF-8 truncation, summary extraction, protocol encoding, tmux wrapping and metadata, detached fallback, event handling, and session commands.
