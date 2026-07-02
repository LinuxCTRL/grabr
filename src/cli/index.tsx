#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { addCommand } from './commands/add';
import { listCommand } from './commands/list';
import { pauseCommand } from './commands/pause';
import { resumeCommand } from './commands/resume';
import { removeCommand } from './commands/remove';
import { clearCommand } from './commands/clear';
import { uiCommand } from './commands/ui';
import { daemonCommand } from './commands/daemon';
import { Dashboard } from './ui/Dashboard';
import { Downloader } from '../core/downloader';
import { loadConfig } from '../core/config';

async function isDaemonRunning(port = 7474): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, {
      signal: AbortSignal.timeout(300),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function showHelp() {
  console.log(`
  grabr — A modern, elegant file downloader built with Bun + TypeScript.

  Usage:
    grabr <command> [options]

  Commands:
    add <url>       Add a new download job.
                     Options:
                       --output, -o <dir>       Output directory (default: ./downloads)
                       --chunks, -c <number>    Number of parallel chunk workers (default: 4)
                       --name,   -n <filename>  Custom output filename
    list            List all jobs and their statuses.
    pause <id|all>  Pause active downloads.
    resume <id|all> Resume paused/failed downloads.
    remove <id>     Remove a download job from the queue and system.
    clear --completed
                    Clear all completed jobs from database.
    ui              Open the Web UI in your default browser.
    daemon [start|stop|status]
                    Manage the background server daemon.

  Run grabr without arguments to open the interactive full-screen dashboard.
  `);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    // Open the interactive dashboard
    const config = loadConfig();
    const port = config.serverPort;
    let running = await isDaemonRunning(port);

    if (!running) {
      console.log('Daemon is not running. Starting Grabr daemon...');
      try {
        const { daemonCommand } = await import('./commands/daemon');
        await daemonCommand(['start']);
        
        // Wait for daemon to become responsive (up to 10 attempts, 2 seconds)
        let attempts = 0;
        while (attempts < 10) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          running = await isDaemonRunning(port);
          if (running) break;
          attempts++;
        }
      } catch (err: any) {
        console.error('Failed to auto-start daemon:', err.message);
      }
    }

    if (running) {
      const { waitUntilExit } = render(
        <Dashboard mode="remote" serverPort={port} />
      );
      await waitUntilExit();
    } else {
      console.log('Could not connect to daemon. Starting dashboard in standalone mode...');
      const downloader = new Downloader();
      await downloader.start();

      const { waitUntilExit } = render(
        <Dashboard mode="local" downloader={downloader} />
      );
      
      await waitUntilExit();
      downloader.stop();
    }
    process.exit(0);
  }

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    case 'add':
      await addCommand(args.slice(1));
      break;
    case 'list':
      await listCommand();
      break;
    case 'pause':
      await pauseCommand(args[1] || '');
      break;
    case 'resume':
      await resumeCommand(args[1] || '');
      break;
    case 'remove':
      await removeCommand(args[1] || '');
      break;
    case 'clear':
      await clearCommand(args.slice(1));
      break;
    case 'ui':
      await uiCommand();
      break;
    case 'daemon':
      await daemonCommand(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
