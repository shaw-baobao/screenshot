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
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const [x, y, w, h] = trimmed.split(',').map((v) => parseInt(v, 10));
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
  return { x, y, w, h };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function screenshotApp(appName, { outDir, filePrefix = 'shot' } = {}) {
  ensureDarwin();
  const tempDir = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'codex-screen-'));
  ensureDir(tempDir);
  const dest = path.join(tempDir, `${filePrefix}-${Date.now()}.png`);

  const tryWindowId = async () => {
    const winId = await getFrontWindowId(appName);
    if (!winId) return false;
    await run('/usr/sbin/screencapture', ['-x', '-o', '-l', String(winId), dest]);
    return fs.existsSync(dest);
  };

  const tryWindowFrame = async () => {
    const frame = await getFrontWindowFrame(appName);
    if (!frame) return false;
    const { x, y, w, h } = frame;
    await run('/usr/sbin/screencapture', ['-x', '-o', '-R', `${x},${y},${w},${h}`, dest]);
    return fs.existsSync(dest);
  };

  const tryFullScreen = async () => {
    await run('/usr/sbin/screencapture', ['-x', '-o', dest]);
    return fs.existsSync(dest);
  };

  try {
    if (await tryWindowId()) return dest;
  } catch (_) {
    // ignore and fall through to frame capture
  }

  try {
    if (await tryWindowFrame()) return dest;
  } catch (_) {
    // ignore and fall through to fullscreen capture
  }

  await tryFullScreen();
  if (!fs.existsSync(dest)) {
    throw new Error('Failed to capture screenshot');
  }
  return dest;
}

export async function copyFileToClipboard(filePath) {
  ensureDarwin();
  const script = `
  on run argv
    set thePath to POSIX file (item 1 of argv)
    set pngData to (read thePath as «class PNGf»)
    tell application "System Events" to set the clipboard to pngData
    return "ok"
  end run`;
  await run('osascript', ['-l', 'AppleScript', '-e', script, filePath]);
}
