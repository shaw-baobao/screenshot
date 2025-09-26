#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { screenshotApp, copyFileToClipboard } from './shared/macos.js';

const server = new McpServer(
  {
    name: 'codex-mcp-screenshot',
    version: '0.1.0'
  }
);

const ScreenshotArgs = {
  app: z.string().min(1, 'app is required'),
  display: z.enum(['auto', 'inline', 'path', 'base64']).optional(),
  copyToClipboard: z.boolean().optional(),
  includeImage: z.boolean().optional()
};

server.tool('screenshot_app', ScreenshotArgs, async (args) => {
  const {
    app,
    display = 'auto',
    copyToClipboard = false,
    includeImage = false
  } = args;

  const imagePath = await screenshotApp(app);

  if (copyToClipboard) {
    await copyFileToClipboard(imagePath);
  }

  const textParts = [`Screenshot saved to: ${imagePath}`];
  if (copyToClipboard) {
    textParts.push('Copied PNG to clipboard.');
  }
  if (display === 'base64') {
    textParts.push('Base64 output suppressed; use includeImage=true if needed.');
  }

  const content = [
    {
      type: 'text',
      text: textParts.join(' ')
    }
  ];

  const metadata = {
    path: imagePath,
    displayRequested: display,
    copiedToClipboard: copyToClipboard,
    includeImage
  };

  if (includeImage) {
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    content.unshift({
      type: 'image',
      data: base64,
      mimeType: 'image/png'
    });
    metadata.base64Length = base64.length;
  }

  return {
    content,
    metadata
  };
});

const transport = new StdioServerTransport();
let keepAlive;

async function shutdown(signal) {
  try {
    if (keepAlive) clearInterval(keepAlive);
    await server.close();
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(signal === 'SIGINT' ? 130 : 0);
  }
}

async function main() {
  await server.connect(transport);

  keepAlive = setInterval(() => {}, 1000);

  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
