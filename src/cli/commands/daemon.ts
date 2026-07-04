import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

export async function daemonCommand(args: string[]) {
  const action = args[0] || 'start';
  const stateDir = join(homedir(), '.grabr');
  const pidFile = join(stateDir, 'daemon.pid');
  const logFile = join(stateDir, 'daemon.log');

  if (action === 'start') {
    if (existsSync(pidFile)) {
      const existingPid = parseInt(readFileSync(pidFile, 'utf-8'), 10);
      if (isProcessRunning(existingPid)) {
        console.log(`Daemon is already running (PID: ${existingPid}).`);
        return;
      } else {
        // Stale PID file
        try {
          unlinkSync(pidFile);
        } catch {}
      }
    }

    console.log('Starting grabr daemon in background...');
    const serverPath = join(process.cwd(), 'src/server/index.ts');

    const out = openSync(logFile, 'a');
    const err = openSync(logFile, 'a');

    const child = spawn('bun', ['run', serverPath], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const pid = child.pid;
    if (pid) {
      writeFileSync(pidFile, pid.toString(), 'utf-8');
      console.log(`Daemon started successfully.`);
      console.log(`  PID: ${pid}`);
      console.log(`  Logs: ${logFile}`);
    } else {
      console.error('Failed to spawn daemon process.');
    }
    child.unref();
  } else if (action === 'stop') {
    if (!existsSync(pidFile)) {
      console.log('Daemon is not running (no PID file found).');
      return;
    }

    const pid = parseInt(readFileSync(pidFile, 'utf-8'), 10);
    if (isProcessRunning(pid)) {
      console.log(`Stopping daemon (PID: ${pid})...`);
      try {
        process.kill(pid, 'SIGTERM');
        // Give it a moment to stop, check if it's dead
        let attempts = 0;
        while (attempts < 5) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (!isProcessRunning(pid)) break;
          attempts++;
        }
        if (isProcessRunning(pid)) {
          process.kill(pid, 'SIGKILL');
        }
        console.log('Daemon stopped.');
      } catch (err: any) {
        console.error(`Error stopping daemon: ${err.message}`);
      }
    } else {
      console.log('Daemon was not running (stale PID file removed).');
    }

    try {
      unlinkSync(pidFile);
    } catch {}
  } else if (action === 'status') {
    if (!existsSync(pidFile)) {
      console.log('Daemon status: Stopped');
      return;
    }

    const pid = parseInt(readFileSync(pidFile, 'utf-8'), 10);
    if (isProcessRunning(pid)) {
      console.log(`Daemon status: Running (PID: ${pid})`);
    } else {
      console.log('Daemon status: Stopped (stale PID file found)');
    }
  } else {
    console.error(`Unknown daemon action: ${action}`);
    console.error('Usage: grabr daemon [start|stop|status]');
    process.exit(1);
  }
}
