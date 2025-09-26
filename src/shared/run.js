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

    child.stdout.on('data', (d) => {
      stdout = Buffer.concat([stdout, d]);
    });

    child.stderr.on('data', (d) => {
      stderr = Buffer.concat([stderr, d]);
    });

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
