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

export async function uiCommand() {
  const config = loadConfig();
  const port = config.serverPort;
  const url = `http://localhost:${port}`;

  const running = await isDaemonRunning(port);
  if (!running) {
    console.log('Daemon is not running. Starting Grabr daemon first...');
    const { daemonCommand } = await import('./daemon');
    await daemonCommand(['start']);
    // Wait 1 second for the HTTP server to bind the port
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  
  console.log(`Opening Web UI in browser: ${url}`);
  
  try {
    if (typeof (Bun as any).openInBrowser === 'function') {
      await (Bun as any).openInBrowser(url);
    } else {
      const os = process.platform;
      if (os === 'darwin') {
        Bun.spawn(['open', url]);
      } else if (os === 'win32') {
        Bun.spawn(['cmd', '/c', 'start', url]);
      } else {
        Bun.spawn(['xdg-open', url]);
      }
    }
  } catch (err: any) {
    console.error(`Failed to open browser: ${err.message}`);
    console.log(`Please open this URL manually: ${url}`);
  }
}
