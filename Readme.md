# codex-mcp-screenshot

A macOS-only Model Context Protocol (MCP) server and CLI that captures the front-most window of a named application. It supports inline previews in compatible terminals, optional clipboard copy, and an on-demand image payload for Codex clients.

## Features
- 🎯 Target the active window by app **name** (e.g., `Safari`, `Xcode`)
- 🪟 Three-level fallback: window-id → window frame crop → full-screen
- 🖼 Inline preview for iTerm2 / Kitty / WezTerm; others receive the saved path
- 📋 Optional PNG copy to the system clipboard
- 🧰 Ships as both an MCP server (`codex-mcp-screenshot`) and CLI (`codex-screenshot`)
- 📦 Published on npm for easy `npx` usage

## Requirements & Permissions
- macOS with the `screencapture` binary (built-in)
- First run will prompt for:
  - **Screen Recording** permission (System Settings → Privacy & Security)
  - **Accessibility** permission (for AppleScript window info)
- Run commands from a terminal/IDE that has these permissions granted

## Install / Update
```bash
npm install -g codex-mcp-screenshot   # optional global install
# or invoke ad-hoc with npx (see below)
```

## Use as a Codex MCP server
Update `~/.config/codex/config.toml`:
```toml
[mcp_servers.screenshot]
command = "npx"
args = ["-y", "codex-mcp-screenshot@latest"]
```
Then in your Codex session call the tool:
```
screenshot_app {"app":"Safari","copyToClipboard":true}
```
The response includes:
- `content`: text summary (path, clipboard status) and, when requested, an image attachment
- `metadata`: path, display preference, and whether the PNG was copied

### Returning the image payload
To avoid overflowing the model context, the server **does not** send base64 image data unless you opt in:
```
screenshot_app {"app":"Safari","includeImage":true}
```
Use this only when you really need the image streamed back to Codex.

## Use as a standalone CLI
```bash
npx codex-mcp-screenshot --app "Safari" --display inline --copy
# shorthand once installed globally
codex-screenshot --app "Xcode" --display path
```
CLI flags:
- `--app <name>` (required): App name as shown in Activity Monitor / Dock
- `--display <auto|inline|path|base64>` (default `auto`)
- `--copy`: copy PNG data to the clipboard
- `--out-dir <path>`: custom destination folder

## Internals
- `src/shared/macos.js` — window discovery + screenshot capture via AppleScript and `screencapture`
- `src/shared/display.js` — inline rendering helpers for supported terminals
- `src/server.js` — MCP entrypoint (also exposed as `codex-mcp-screenshot` bin)
- `src/cli.js` — CLI wrapper around the same capture pipeline

## License
MIT
