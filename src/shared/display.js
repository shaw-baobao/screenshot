import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';

const TERMINAL = {
  ITERM: 'iterm2',
  KITTY: 'kitty',
  WEZTERM: 'wezterm'
};

export function detectInlineSupport(env = process.env) {
  if (env.TERM_PROGRAM === 'iTerm.app') return TERMINAL.ITERM;
  if (env.KITTY_WINDOW_ID || (env.TERM && env.TERM.includes('kitty'))) return TERMINAL.KITTY;
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === 'WezTerm') return TERMINAL.WEZTERM;
  return null;
}

function fileToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function renderIterm(base64, fileName, stdout) {
  const payloadName = Buffer.from(fileName).toString('base64');
  const escape = `\u001B]1337;File=name=${payloadName};inline=1:${base64}\u0007`;
  stdout.write(`${escape}\n`);
}

function renderKitty(base64, stdout) {
  const escape = `\u001BGf=100,a=T;${base64}\u001B\\`;
  stdout.write(`${escape}\n`);
}

async function renderWezTerm(imagePath, stdout) {
  try {
    const { stdout: weztermOut } = await run('wezterm', ['imgcat', imagePath]);
    stdout.write(weztermOut.endsWith('\n') ? weztermOut : `${weztermOut}\n`);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    return false;
  }
}

export async function displayImage({ imagePath, display = 'auto', stdout = process.stdout }) {
  const support = detectInlineSupport();
  const resolvedDisplay = display || 'auto';
  const info = { display: resolvedDisplay, inline: false, method: null };

  const showPath = () => {
    stdout.write(`Screenshot saved to: ${imagePath}\n`);
    return { ...info, display: 'path' };
  };

  const showBase64 = () => {
    const base64 = fileToBase64(imagePath);
    stdout.write(`${base64}\n`);
    return { ...info, display: 'base64', base64Length: base64.length };
  };

  const showInline = async (mode) => {
    const base64 = fileToBase64(imagePath);
    const fileName = path.basename(imagePath);

    if (mode === TERMINAL.ITERM) {
      renderIterm(base64, fileName, stdout);
      return { ...info, inline: true, method: mode };
    }

    if (mode === TERMINAL.KITTY) {
      renderKitty(base64, stdout);
      return { ...info, inline: true, method: mode };
    }

    if (mode === TERMINAL.WEZTERM) {
      const ok = await renderWezTerm(imagePath, stdout);
      if (ok) return { ...info, inline: true, method: mode };
    }

    return null;
  };

  if (resolvedDisplay === 'base64') return showBase64();
  if (resolvedDisplay === 'path') return showPath();
  if (resolvedDisplay === 'inline') {
    if (!support) return showPath();
    const res = await showInline(support);
    return res || showPath();
  }

  // auto
  if (support) {
    const res = await showInline(support);
    if (res) return res;
  }

  stdout.write(`Screenshot saved to: ${imagePath}\n`);
  const base64 = fileToBase64(imagePath);
  stdout.write(`Base64 prefix: ${base64.slice(0, 80)}...\n`);
  return { ...info, display: 'auto', inline: false, method: support, base64Prefix: base64.slice(0, 80) };
}
