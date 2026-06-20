import { loadConfig } from '../../core/config';
import { clearCompletedJobs } from '../../store/jobs';

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

export async function clearCommand(args: string[]) {
  const isCompletedOnly = args.includes('--completed');

  if (!isCompletedOnly) {
    console.error('Error: Currently, grabr clear only supports clearing completed jobs.');
    console.error('Usage: grabr clear --completed');
    process.exit(1);
  }

  const config = loadConfig();
  const port = config.serverPort;
  const running = await isDaemonRunning(port);

  if (running) {
    try {
      const res = await fetch(`http://localhost:${port}/api/jobs/clear-completed`, { method: 'POST' });
      if (res.ok) {
        console.log('Cleared completed jobs from daemon.');
      } else {
        const errorText = await res.text();
        console.error(`Failed to clear jobs: ${errorText}`);
      }
    } catch (err: any) {
      console.error(`Error communicating with daemon: ${err.message}`);
    }
  } else {
    // Offline Database fallback
    try {
      await clearCompletedJobs();
      console.log('Cleared completed jobs from database.');
    } catch (err: any) {
      console.error(`Failed to clear database jobs: ${err.message}`);
    }
  }
}
