# Vibe Island Windows

Windows private prototype of an AI agent status island.

## Status

- Top-center always-on-top island window.
- Settings/control window with agent detection and hook install/uninstall.
- System tray, startup preference, notifications, workspace jump.
- Local loopback IPC for hook events and permission requests.
- Hook helper with safe fallback: unavailable permission requests never auto-approve.
- Unit and integration tests for normalization, config adapters, IPC, and hook fallback.

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

## Local IPC

The app writes runtime connection info to `%APPDATA%\Vibe Island\runtime.json`.

- `GET /v1/health`
- `POST /v1/events`
- `POST /v1/permission/request`
- `POST /v1/permission/respond`

Example event:

```powershell
'{"hook_event_name":"PostToolUse","session_id":"smoke","cwd":"O:\\w_Isaland","tool_name":"Shell","tool_input":{"command":"npm test"}}' |
  node scripts\vibe-island-hook.mjs --agent claude --event PostToolUse
```

## Hook Management

Mutating agent config is done from the settings window. Each install creates a timestamped backup before writing managed hook entries.

Supported adapter targets:

- `%USERPROFILE%\.codex\hooks.json`
- `%USERPROFILE%\.claude\settings.json`
- `%USERPROFILE%\.gemini\settings.json`
- `%USERPROFILE%\.config\opencode\opencode.json`

Codex hooks are marked experimental because Windows support depends on the installed Codex build.

## Outputs

- Development renderer: `http://localhost:5173/`
- Unpacked app: `release\win-unpacked\Vibe Island.exe`
- Zip package: `release\Vibe Island-0.1.0-x64.zip`
