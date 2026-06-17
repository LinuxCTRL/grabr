import { loadConfig } from '../../core/config';
import { getJob, deleteJob } from '../../store/jobs';
import { deleteResumeState } from '../../core/resume';

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

export async function removeCommand(id: string) {
  if (!id) {
    console.error('Error: Please provide a job ID.');
    console.error('Usage: grabr remove <id>');
    process.exit(1);
  }

  const config = loadConfig();
  const port = config.serverPort;
  const running = await isDaemonRunning(port);

  if (running) {
    try {
      const res = await fetch(`http://localhost:${port}/api/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        console.log(`Removed job ${id}.`);
      } else {
        const errorText = await res.text();
        console.error(`Failed to remove job: ${errorText}`);
      }
    } catch (err: any) {
      console.error(`Error communicating with daemon: ${err.message}`);
    }
  } else {
    // Offline Database fallback
    const job = getJob(id);
    if (job) {
      deleteJob(id);
      deleteResumeState(id);
      console.log(`Removed job ${id} from database.`);
    } else {
      console.error(`Job with ID ${id} not found.`);
    }
  }
}
