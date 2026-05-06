# Island_Win

Vibe Island for Windows is an Electron prototype that shows AI agent activity in a top-center "island" window. It listens for local hook events, tracks recent sessions, surfaces notifications and permission/question prompts, and provides a settings window for installing managed hooks.

This project references [Octane0411/open-vibe-island](https://github.com/Octane0411/open-vibe-island).

Clone with the reference project:

```powershell
git clone --recurse-submodules https://github.com/MiaoSir-YH/Island_Win.git
```

## Current Status

- Stable core: always-on-top island window, settings window, tray menu, startup preference, local loopback IPC, hook install/uninstall, event normalization, notification promotion, persisted sessions/events/config, and safe hook fallback.
- Windows additions: expanded agent adapters, OpenCode plugin generation, permission/question routing, Claude statusLine bridge, best-effort workspace or terminal jump, transcript session discovery, usage-cache reading, diagnostics snapshots, Windows system sounds, theme/accent settings, electron-updater wiring, and experimental remote event stream.
- Best-effort areas: precise jump, Codex app-server ingestion, transcript discovery, usage display, remote access, and some non-Claude/Codex hook schemas depend on the installed agent version and may require manual validation.
- Not complete yet: automatic update publishing still needs release credentials and signed artifacts, English UI coverage is focused on settings rather than every island string, and precise terminal/session focus remains best-effort.

## Commands

```powershell
npm install
npm run dev
npm test
npm run build
npm run package:dir
npm run package:zip
```

`npm run package` builds an NSIS installer. It requires electron-builder's NSIS binary cache; if GitHub downloads are blocked, use `npm run package:zip` or `npm run package:dir`.

## Runtime Files

The app stores runtime and user data under `%APPDATA%\Vibe Island`.

- `runtime.json`: local IPC host, port, bearer token, PID, and start time.
- `config.json`: persisted settings such as notifications, theme, sound, experiments, update, and remote flags.
- `sessions.json`: recent live and discovered sessions.
- `events.jsonl`: normalized event history.
- `spool.jsonl`: hook events that could not reach the app; permission/question fallback output never auto-approves.

## Local IPC

The local IPC server binds to `127.0.0.1` on a random port and writes connection info to `%APPDATA%\Vibe Island\runtime.json`.

Authenticated endpoints accept either `Authorization: Bearer <token>` or `x-vibe-island-token: <token>`.

- `GET /v1/health`: unauthenticated health check.
- `POST /v1/events`: normalized activity events; permission-like or question-like payloads are routed as actionable requests.
- `POST /v1/permission/request`: explicit permission request.
- `POST /v1/question/request`: explicit question/input request.
- `POST /v1/permission/respond`: resolves a pending request when a compatible response is provided.

Example event:

```powershell
'{"hook_event_name":"PostToolUse","session_id":"smoke","cwd":"O:\\w_Island","tool_name":"Shell","tool_input":{"command":"npm test"}}' |
  node scripts\vibe-island-hook.mjs --agent claude --event PostToolUse
```

Example permission request:

```powershell
'{"hook_event_name":"PreToolUse","session_id":"smoke","cwd":"O:\\w_Island","tool_name":"Shell","tool_input":{"command":"Remove-Item -Recurse C:\\temp\\demo"}}' |
  node scripts\vibe-island-hook.mjs --agent claude --event PreToolUse
```

If Vibe Island is unavailable, the helper spools the request and prints `{}` for permission/question hooks. That fallback is intentionally safe: it does not approve the action.

## Permissions And Questions

Permission and question payloads normalize into a shared actionable request shape with `kind`, `agent`, `sessionId`, `workspace`, `toolName`, `action`, `prompt`, `choices`, `command`, `risk`, and `timeoutMs`.

Current behavior:

- The island and settings views surface pending requests with risk and command context.
- Timeouts return a `timeout` decision, capped to an 8 second visible notice.
- The IPC model supports `allow`, `deny`, `denyForSession`, `timeout`, and `answer` responses.
- The island/settings renderer exposes approve, deny, deny-for-session, choice answer, typed answer, and skip controls.
- Remote or custom tooling can also post compatible responses to the resolution endpoint, but remote mode remains experimental.

## Agent Hooks

Mutating agent config is done from the settings window. Each install creates a timestamped backup before writing managed entries marked with `managed-by-vibe-island`. Uninstall removes only managed entries.

Supported adapter targets:

| Agent | Target | Notes |
| --- | --- | --- |
| Codex | `%USERPROFILE%\.codex\hooks.json` | Experimental on Windows; supported events depend on the installed Codex build. |
| Claude Desktop / Code | `%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json` when present, otherwise `%USERPROFILE%\.claude\settings.json` | Preserves unrelated config and existing hooks. |
| Gemini CLI | `%USERPROFILE%\.gemini\settings.json` | Claude-style managed hook entries. |
| OpenCode | `%USERPROFILE%\.config\opencode\plugins\vibe-island.js` | Writes a managed JavaScript plugin that routes OpenCode events through the helper. |
| Cursor | `%USERPROFILE%\.cursor\hooks.json` | Best-effort hook schema. |
| Kimi CLI | `%USERPROFILE%\.kimi\config.toml` | Writes managed `[[hooks]]` TOML blocks. |
| Qoder | `%USERPROFILE%\.qoder\settings.json` | Best-effort hook schema. |
| Qwen Code | `%USERPROFILE%\.qwen\settings.json` | Best-effort hook schema. |
| Factory | `%USERPROFILE%\.factory\settings.json` | Best-effort hook schema. |
| CodeBuddy | `%USERPROFILE%\.codebuddy\settings.json` | Best-effort hook schema. |

Claude statusLine is managed separately from hook install. The settings UI can write a managed `statusLine` command to `%USERPROFILE%\.claude\settings.json`; if a user custom status line already exists, Vibe Island leaves it untouched and reports that it was not overwritten.

Detection is local and conservative: it checks for known commands in `PATH` and for expected config directories/files. A detected adapter does not guarantee the target agent accepts the generated hook schema.

## Jump Behavior

Session chips can jump to a workspace when a session has a workspace path.

- `workspace`: opens the workspace in the first supported editor found in `PATH`.
- `terminal`: opens or focuses Windows Terminal, optionally in the workspace directory.
- `precise`: config-level experimental mode that tries Windows Terminal with the workspace, then falls back to editor opening.
- `none`: disables jump.

Supported editor candidates include VS Code, Cursor, Windsurf, Trae, and several JetBrains IDE executables. This is best-effort process launching, not guaranteed focus of the exact originating terminal/session.

## Session Discovery

When `experiments.sessionDiscovery` is enabled, Vibe Island scans local transcript/session folders and merges the newest discovered sessions into the session list:

- `%USERPROFILE%\.codex\sessions`
- `%USERPROFILE%\.claude\projects`
- `%USERPROFILE%\.cursor\sessions`
- `%USERPROFILE%\.kimi\sessions`

Discovery reads `.jsonl` and `.json` files, uses the last parseable line for basic metadata, caps results, and marks old items as `stale`. It is useful for context, but live hook events are more reliable.

## Usage And Diagnostics

Usage is cache-based only. The app currently reads:

- `%USERPROFILE%\.codex\usage.json`
- `%USERPROFILE%\.claude\usage.json`

Expected cache windows include five-hour and seven-day fields such as `fiveHour`, `five_hour`, `5h`, `sevenDay`, `seven_day`, or `7d`. If a cache is missing or unparseable, usage is reported as unavailable; the app does not query vendor services.

Diagnostics snapshots include:

- runtime path
- hook helper path
- local IPC health
- last runtime/service error
- checked timestamp

## Notifications, Sound, And Appearance

- Notification strategies: `focused`, `realtime`, and `silent`.
- Windows notifications are shown for promoted events when notifications are enabled and strategy is not silent.
- Sound uses PowerShell and Windows system sounds (`asterisk`, `beep`, `exclamation`, `hand`, `question`). The settings UI exposes on/off, sound name, and volume.
- Appearance settings include `system`, `light`, and `dark` modes plus accent themes.
- `language` is persisted as `zh-CN` or `en-US`, defaulting to `zh-CN`. Settings-page navigation, preferences, diagnostics, advanced controls, and date formatting use the language setting; some compact island/status strings still use fixed Chinese copy.

## Updates

The update checker uses `electron-updater` and the package config points at the GitHub repository provider.

- `update.enabled: false` reports idle with automatic updates disabled.
- `update.enabled: true` records a check timestamp and asks `electron-updater` to check the configured provider in packaged builds.
- Development builds report that update checks run only from packaged builds.

Publishing still requires release artifacts on GitHub and, for production distribution, code signing.

## Remote Endpoint

Remote mode is experimental and disabled by default. When `remote.enabled` is true in `config.json`, the app starts a separate HTTP server bound to `0.0.0.0` on a random port.

Remote endpoints use a query token:

- `GET /v1/remote/events?token=<token>`: server-sent event stream for normalized events and permission/question requests.
- `POST /v1/remote/resolve?token=<token>`: posts a `PermissionResponse` body to resolve a pending request.

The settings UI exposes the remote toggle, token field, and actual remote server URL while the server is running. If enabled without a token, the app generates and persists one. Only enable it on trusted networks.

## Outputs

- Development renderer: `http://localhost:5173/`
- Unpacked app: `release\win-unpacked\Vibe Island.exe`
- Zip package: `release\Vibe Island-0.1.0-x64.zip`
