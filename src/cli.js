#!/usr/bin/env node
import process from 'node:process';
import { screenshotApp, copyFileToClipboard } from './shared/macos.js';
import { displayImage } from './shared/display.js';

function parseArgs(argv) {
  const args = { display: 'auto', copy: false };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--app' && i + 1 < argv.length) {
      args.app = argv[++i];
    } else if (current === '--display' && i + 1 < argv.length) {
      args.display = argv[++i];
    } else if (current === '--copy') {
      args.copy = true;
    } else if (current === '--help' || current === '-h') {
      args.help = true;
    } else if (current === '--out-dir' && i + 1 < argv.length) {
      args.outDir = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${current}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: codex-screenshot --app <AppName> [--display inline|path|base64|auto] [--copy] [--out-dir <dir>]\n`);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help || !args.app) {
      printHelp();
      if (!args.app) process.exitCode = 1;
      return;
    }

    const imagePath = await screenshotApp(args.app, { outDir: args.outDir });
    await displayImage({ imagePath, display: args.display, stdout: process.stdout });

    if (args.copy) {
      await copyFileToClipboard(imagePath);
      console.log('Copied PNG to clipboard');
    }
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

main();
