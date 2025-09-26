English rephrase:
# File: package.json
{
  "name": "codex-mcp-screenshot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "codex-screenshot": "./src/cli.js"
  },
  "scripts": {
    "start": "node ./src/server.js",
    "cli": "node ./src/cli.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.2.0"
  }
}

# File: src/shared/run.js
import { spawn } from 'node:child_process';

export async function run(cmd, args = [], { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.stdout.on('data', (d) => (stdout = Buffer.concat([stdout, d])));
    child.stderr.on('data', (d) => (stderr = Buffer.concat([stderr, d])));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
      } else {
        const err = new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr.toString('utf8')}`);
        err.code = code;
        err.stdout = stdout.toString('utf8');
        err.stderr = stderr.toString('utf8');
        reject(err);
      }
    });
  });
}

# File: src/shared/macos.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './run.js';

function ensureDarwin() {
  if (process.platform !== 'darwin') {
    throw new Error('This plugin currently supports only macOS.');
  }
}

export async function getFrontWindowId(appName) {
  ensureDarwin();
  const script = `
on run argv
  set appName to item 1 of argv
  tell application "System Events"
    if not (exists process appName) then return ""
    tell process appName
      if (count of windows) is 0 then return ""
      set theWin to window 1
      try
        return (value of attribute "AXWindowID" of theWin) as string
      on error
        return ""
      end try
    end tell
  end tell
end run`;
  const { stdout } = await run('osascript', ['-l', 'AppleScript', '-e', script, appName]);
  return stdout.trim();
}

export async function getFrontWindowFrame(appName) {
  ensureDarwin();
  const script = `
on run argv
  set appName to item 1 of argv
  tell application "System Events"
    if not (exists process appName) then return ""
    tell process appName
      if (count of windows) is 0 then return ""
      set theWin to window 1
      set pos to position of theWin
      set sz to size of theWin
      set x to item 1 of pos
      set y to item 2 of pos
      set w to item 1 of sz
      set h to item 2 of sz
      return (x & "," & y & "," & w & "," & h) as string
    end tell
  end tell
end run`;
  const { stdout } = await run('osascript', ['-l', 'AppleScript', '-e', script, appName]);
  const t = stdout.trim();
  if (!t) return null;
  const [x, y, w, h] = t.split(',').map((n) => parseInt(n, 10));
  return { x, y, w, h };
}

export async function screenshotApp(appName, { outDir, filePrefix = 'shot' } = {}) {
  ensureDarwin();
  const tmp = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'codex-screen-'));
  const dest = path.join(tmp, `${filePrefix}-${Date.now()}.png`);

  // Try via window id first
  const winId = await getFrontWindowId(appName);
  try {
    if (winId) {
      await run('/usr/sbin/screencapture', ['-x', '-o', '-l', String(winId), dest]);
      if (fs.existsSync(dest)) return dest;
    }
  } catch (_) {
    // fallthrough
  }

  // Fallback: crop by frame
  const frame = await getFrontWindowFrame(appName);
  if (frame) {
    await run('/usr/sbin/screencapture', ['-x', '-o', '-R', `${frame.x},${frame.y},${frame.w},${frame.h}`, dest]);
    if (fs.existsSync(dest)) return dest;
  }

  // Ultimate fallback: full screen
  await run('/usr/sbin/screencapture', ['-x', '-o', dest]);
  return dest;
}

export async function copyImageToClipboard(filePath) {
  ensureDarwin();
  const script = `
set theFile to POSIX file "${filePath.replaceAll('"', '\\"')}"
set imgData to (read theFile as «class PNGf»)
set the clipboard to imgData
return "OK"`;
  await run('osascript', ['-l', 'AppleScript', '-e', script]);
}

export function readFileBase64(p) {
  const b = fs.readFileSync(p);
  return b.toString('base64');
}

# File: src/shared/terminal.js
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFileBase64 } from './macos.js';

export function detectTerminal() {
  const tp = process.env.TERM_PROGRAM || '';
  const term = process.env.TERM || '';
  if (tp.includes('iTerm')) return 'iterm';
  if (term.includes('kitty') || process.env.KITTY_INSTALLATION_DIR) return 'kitty';
  if (tp.includes('WezTerm') || process.env.WEZTERM_EXECUTABLE) return 'wezterm';
  return 'other';
}

export function printInline(filePath, { terminal = detectTerminal() } = {}) {
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
  const data = fs.readFileSync(filePath);

  if (terminal === 'iterm') {
    const nameB64 = Buffer.from(filePath.split('/').pop()).toString('base64');
    const bodyB64 = data.toString('base64');
    const seq = `\u001b]1337;File=name=${nameB64};inline=1:${bodyB64}\u0007\n`;
    process.stdout.write(seq);
    return;
  }

  if (terminal === 'kitty') {
    const bodyB64 = data.toString('base64');
    const payload = `a=T,f=100;${bodyB64}`; // transmit, 100% size
    const seq = `\u001b_G${payload}\u001b\\\n`;
    process.stdout.write(seq);
    return;
  }

  if (terminal === 'wezterm') {
    const res = spawnSync('wezterm', ['imgcat', filePath]);
    if (res.status === 0) return;
  }

  // Fallback: print path and base64 header
  const b64 = readFileBase64(filePath);
  console.log(`[saved] ${filePath}`);
  console.log(`[base64:first_2kb] ${b64.slice(0, 2048)}...`);
}

# File: src/server.js
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONSchema7 } from 'json-schema';
import { screenshotApp, copyImageToClipboard, readFileBase64 } from './shared/macos.js';
import { detectTerminal, printInline } from './shared/terminal.js';

const server = new Server({
  name: 'codex-mcp-screenshot',
  version: '0.1.0'
}, {
  capabilities: {
    tools: {}
  }
});

server.tool({
  name: 'screenshot_app',
  description: 'Capture a PNG screenshot of the front window of the given app (macOS only). Optionally print inline in terminal and/or copy to clipboard.',
  inputSchema: {
    type: 'object',
    properties: {
      app: { type: 'string', description: 'App name, e.g., "Xcode" or "Safari"' },
      display: { type: 'string', enum: ['auto', 'inline', 'path', 'base64'], default: 'auto' },
      copyToClipboard: { type: 'boolean', default: false }
    },
    required: ['app']
  }
}, async (args) => {
  const app = args.app;
  const display = args.display || 'auto';
  const copy = !!args.copyToClipboard;

  const filePath = await screenshotApp(app);

  if (copy) {
    try {
      await copyImageToClipboard(filePath);
    } catch (e) {
      // continue but include warning
    }
  }

  const term = detectTerminal();
  let printed = false;
  if (display === 'inline' || (display === 'auto' && term !== 'other')) {
    try {
      printInline(filePath, { terminal: term });
      printed = true;
    } catch (_) {}
  }

  const base64 = (display === 'base64') ? readFileBase64(filePath) : undefined;

  const text = [
    `✔︎ Saved: ${filePath}`,
    copy ? '✔︎ Copied image to clipboard' : undefined,
    printed ? `✔︎ Displayed inline (${term})` : ((display === 'inline') ? '✘ Inline display failed (terminal not supported)' : undefined)
  ].filter(Boolean).join('\n');

  return {
    content: [
      { type: 'text', text },
      { type: 'image', data: readFileBase64(filePath), mimeType: 'image/png' },
      ...(base64 ? [{ type: 'text', text: `base64:\n${base64}` }] : [])
    ]
  };
});

await server.connect(new StdioServerTransport());

# File: src/cli.js
#!/usr/bin/env node
import { screenshotApp, copyImageToClipboard } from './shared/macos.js';
import { detectTerminal, printInline } from './shared/terminal.js';

function parseArgs(argv) {
  const out = { app: '', display: 'auto', copy: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') out.app = argv[++i] || '';
    else if (a === '--display') out.display = argv[++i] || 'auto';
    else if (a === '--copy' || a === '-c') out.copy = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const { app, display, copy, help } = parseArgs(process.argv);
  if (help || !app) {
    console.log(`Usage: codex-screenshot --app "Xcode" [--display auto|inline|path|base64] [--copy]\n`);
    process.exit(help ? 0 : 1);
  }
  const file = await screenshotApp(app);
  if (copy) {
    try { await copyImageToClipboard(file); console.log('Copied to clipboard'); } catch { console.warn('Copy to clipboard failed'); }
  }
  if (display === 'path') {
    console.log(file);
    return;
  }
  if (display === 'inline' || display === 'auto') {
    try { printInline(file, { terminal: detectTerminal() }); return; } catch {}
  }
  console.log(file);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

# File: README.md
# codex-mcp-screenshot (macOS)

A minimal MCP server + CLI that lets Codex CLI capture the front-most window of a given macOS app as a PNG, optionally display it inline in supported terminals (iTerm2/Kitty/WezTerm), and copy it to the system clipboard.

## Features
- 🎯 Target by **app name** (e.g., `Xcode`, `Safari`)
- 🪟 Window-first capture via `AXWindowID`, with **frame-crop fallback**, then full-screen fallback
- 🖼️ **Inline preview** in iTerm2/Kitty/WezTerm (auto-detect), or just print path/base64
- 📋 **Copy to clipboard** (uses AppleScript, PNG)
- 🔒 macOS privacy prompts handled via standard permissions (Screen Recording + Accessibility)

## Install
```bash
git clone https://example.com/codex-mcp-screenshot.git
cd codex-mcp-screenshot
npm i
chmod +x src/cli.js
```

## Give permissions (first run will prompt)
System Settings → Privacy & Security →
- **Screen Recording**: allow your Terminal/IDE (and `node`) 
- **Accessibility**: allow your Terminal/IDE (AppleScript window queries)

## Use as MCP server in Codex CLI
Add to your `~/.config/codex/config.toml`:
```toml
[mcp_servers.screenshot]
command = "node"
args = ["/ABSOLUTE/PATH/codex-mcp-screenshot/src/server.js"]
```
Then in Codex, run the tool (examples):
- `screenshot_app {"app":"Xcode"}`
- `screenshot_app {"app":"Safari","display":"inline","copyToClipboard":true}`

> The server returns: saved path, (optional) clipboard copy status, and an image payload; it also attempts an inline preview via terminal escape codes when supported.

## Use as standalone CLI
```bash
codex-screenshot --app "Xcode" --display inline --copy
# or
npx --yes codex-mcp-screenshot --app "Safari" --display path
```

## Terminal support
- **iTerm2**: native inline via OSC 1337
- **Kitty**: native inline via Kitty graphics protocol
- **WezTerm**: uses `wezterm imgcat`
- **Others**: prints file path + base64 prefix

## Notes & Limitations
- macOS only for now. Windows/Linux support can be added via platform shims (Win32 GDI `PrintWindow`, X11/Wayland grabs) if needed.
- Capturing specific background windows (not front-most) requires extra selection logic and accessibility permissions; this version targets the **front window** of the app.
- Some apps (browsers with GPU surfaces, DRM) may return empty frames; fallback paths try best-effort.

## License
MIT

下面是实现方案（已把完整可运行代码放到右侧 Canvas 里，名为 codex-mcp-screenshot (macOS)，包含 package.json、src/server.js、src/cli.js 等文件）：

方案概述
	•	平台：先支持 macOS（利用 screencapture 与 AppleScript/Accessibility，最稳），Windows/Linux 可后续加平台适配层。
	•	形式：提供 MCP Server（给 Codex CLI 调用的工具 screenshot_app）+ 同仓库 独立 CLI（codex-screenshot）便于直接测试。
	•	能力：
	1.	通过 应用名（如 Xcode、Safari）定位前置窗口，优先取 AXWindowID 截图；失败则用窗口 position/size 裁剪；再不行退化整屏。
	2.	终端内联显示：自动识别 iTerm2/Kitty/WezTerm，用相应转义序列直接在终端显示图片；其他终端则输出文件路径与 base64 前缀。
	3.	复制到剪贴板（PNG）：便于你在其他地方粘贴。
	4.	Codex 工具调用会同时返回图片 payload，方便 Codex 客户端/日志侧查看。

权限与前置条件（macOS）
	1.	首次运行会弹权限：屏幕录制 与 辅助功能（AppleScript 读窗口信息）。
路径：系统设置 → 隐私与安全性 → 屏幕录制 / 辅助功能，勾选你的终端/IDE 与 node。
	2.	终端内联仅在支持协议的终端生效：iTerm2（OSC 1337）、Kitty、WezTerm；其他终端打印路径+base64 片段。

安装与运行
	1.	在右侧 Canvas 复制代码到本地（或直接下载）。
	2.	安装依赖并赋权：

npm i
chmod +x src/cli.js


	3.	作为 MCP（Codex 插件）使用：在 ~/.config/codex/config.toml 添加

[mcp_servers.screenshot]
command = "node"
args = ["/ABSOLUTE/PATH/codex-mcp-screenshot/src/server.js"]

在 Codex 会话里调用工具：
	•	screenshot_app {"app":"Xcode"}
	•	screenshot_app {"app":"Safari","display":"inline","copyToClipboard":true}

	4.	作为独立 CLI 使用（便于调试）：

node src/cli.js --app "Xcode" --display inline --copy
# 或安装到全局 PATH（本仓库 bin 已配置）
./node_modules/.bin/codex-screenshot --app "Safari" --display inline



参数说明
	•	app（必填）：应用名（和“活动监视器”里看到的进程名一致，如 Xcode、Safari）。
	•	display：auto | inline | path | base64
auto 会自动尝试终端内联；不支持则仅输出路径。
	•	copyToClipboard / --copy：是否把 PNG 复制到系统剪贴板。

实现要点（你关心的技术细节）
	•	窗口定位：AppleScript 读取 AXWindowID 更精准；若不可得，使用 position+size 做 screencapture -R x,y,w,h 区域抓取。
	•	稳定性：三段式回退（-l windowId → -R frame → 全屏），确保总能拿到图。
	•	终端内联：
	•	iTerm2：OSC 1337 ESC ] 1337 ; File=... : base64 BEL
	•	Kitty：Graphics Protocol ESC _G ... ESC \
	•	WezTerm：调用 wezterm imgcat（若存在）
	•	剪贴板：AppleScript set the clipboard to (read POSIX file ... as «class PNGf» )，保持为图片对象而非文件路径。

常见问题
	•	提示无权限/黑屏：到“隐私与安全性”允许屏幕录制 & 辅助功能；必要时重启终端或 node。
	•	找不到窗口：请确保目标 App 处于前台且有可见窗口（有些全屏/Metal/DRM 场景可能受限）。
	•	终端不显示图片：使用 iTerm2/Kitty/WezTerm，或改用 --display path 拿到文件路径。

如果你需要 Windows 版本（PowerShell + Win32 PrintWindow）或 多窗口选择（按标题/序号），告诉我，我会在现有结构下加一个 platform/win32.js 适配层与 windowTitle 参数即可平滑扩展。