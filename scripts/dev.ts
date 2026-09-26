import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const processes: ChildProcess[] = [
  spawn(
    process.execPath,
    ['--watch', '--env-file=.env.development.local', '--import', 'tsx', 'server/index.ts'],
    { stdio: 'inherit', env: process.env },
  ),
  spawn(
    process.execPath,
    [path.resolve('node_modules', 'vite', 'bin', 'vite.js'), '--config', 'frontend/vite.config.ts'],
    { stdio: 'inherit', env: process.env },
  ),
];

let stopping = false;

function stopChildTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    stopChildTree(child);
  }
  process.exitCode = exitCode;
}

for (const child of processes) {
  child.on('error', (err) => {
    process.stderr.write(`development process failed to start: ${err.message}\n`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (signal) process.stderr.write(`development process exited from signal ${signal}\n`);
    stop(code ?? 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
