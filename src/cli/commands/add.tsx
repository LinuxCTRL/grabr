import React from 'react';
import { render } from 'ink';
import { Dashboard } from '../ui/Dashboard';
import { Downloader } from '../../core/downloader';
import { loadConfig } from '../../core/config';

async function isDaemonRunning(port = 7474): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function addCommand(args: string[]) {
  const config = loadConfig();
  const port = config.serverPort;

  // Parse arguments manually
  let url = '';
  let outputDir = '';
  let chunks = config.defaultChunks;
  let filename = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      outputDir = args[++i] || '';
    } else if (arg === '--chunks' || arg === '-c') {
      chunks = parseInt(args[++i] || `${config.defaultChunks}`, 10);
    } else if (arg === '--name' || arg === '-n') {
      filename = args[++i] || '';
    } else if (!arg.startsWith('-') && !url) {
      url = arg;
    }
  }

  if (!url) {
    console.error('Error: Please provide a download URL.');
    console.error('Usage: grabr add <url> [--output <dir>] [--chunks <n>] [--name <filename>]');
    process.exit(1);
  }

  const running = await isDaemonRunning(port);

  if (running) {
    // Add via Daemon HTTP POST
    try {
      const response = await fetch(`http://localhost:${port}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          options: {
            outputDir: outputDir || undefined,
            chunks,
            filename: filename || undefined,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error adding download via daemon: ${errorText}`);
        process.exit(1);
      }

      console.log('Job added to daemon successfully. Opening live view...');
      
      // Render Ink Remote Dashboard
      const { waitUntilExit } = render(
        <Dashboard mode="remote" serverPort={port} />
      );
      await waitUntilExit();
    } catch (err: any) {
      console.error(`Failed to add job to daemon: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Run Standalone Local Downloader
    console.log('Daemon is not running. Starting download in standalone mode...');
    const downloader = new Downloader();
    downloader.start();

    try {
      await downloader.addJob(url, {
        outputDir: outputDir || undefined,
        chunks,
        filename: filename || undefined,
      });

      // Render Ink Local Dashboard
      const { waitUntilExit } = render(
        <Dashboard mode="local" downloader={downloader} />
      );
      
      await waitUntilExit();
      
      // Stop downloader on exit (saves any in-progress state)
      downloader.stop();
    } catch (err: any) {
      downloader.stop();
      console.error(`Error starting download: ${err.message}`);
      process.exit(1);
    }
  }
}
