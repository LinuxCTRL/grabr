import { loadConfig } from '../../core/config';
import { getJob, updateJob, listJobs } from '../../store/jobs';
import { saveResumeState } from '../../core/resume';

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

export async function pauseCommand(id: string) {
  if (!id) {
    console.error('Error: Please provide a job ID or "all".');
    console.error('Usage: grabr pause <id|all>');
    process.exit(1);
  }

  const config = loadConfig();
  const port = config.serverPort;
  const running = await isDaemonRunning(port);

  if (running) {
    try {
      const endpoint = id === 'all' 
        ? `http://localhost:${port}/api/jobs/pause-all`
        : `http://localhost:${port}/api/jobs/${id}/pause`;
        
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) {
        console.log(id === 'all' ? 'Paused all jobs.' : `Paused job ${id}.`);
      } else {
        const errorText = await res.text();
        console.error(`Failed to pause: ${errorText}`);
      }
    } catch (err: any) {
      console.error(`Error communicating with daemon: ${err.message}`);
    }
  } else {
    // Offline Database fallback
    if (id === 'all') {
      const jobs = await listJobs();
      let count = 0;
      for (const job of jobs) {
        if (job.status === 'downloading' || job.status === 'queued') {
          job.status = 'paused';
          job.speed = 0;
          job.eta = -1;
          await updateJob(job);
          saveResumeState(job);
          count++;
        }
      }
      console.log(`Paused ${count} jobs in database.`);
    } else {
      const job = await getJob(id);
      if (job) {
        if (job.status === 'downloading' || job.status === 'queued') {
          job.status = 'paused';
          job.speed = 0;
          job.eta = -1;
          await updateJob(job);
          saveResumeState(job);
          console.log(`Paused job ${id} in database.`);
        } else {
          console.log(`Job ${id} is already ${job.status}.`);
        }
      } else {
        console.error(`Job with ID ${id} not found.`);
      }
    }
  }
}
