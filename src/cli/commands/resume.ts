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

export async function resumeCommand(id: string) {
  if (!id) {
    console.error('Error: Please provide a job ID or "all".');
    console.error('Usage: grabr resume <id|all>');
    process.exit(1);
  }

  const config = loadConfig();
  const port = config.serverPort;
  const running = await isDaemonRunning(port);

  if (running) {
    try {
      const endpoint = id === 'all' 
        ? `http://localhost:${port}/api/jobs/resume-all`
        : `http://localhost:${port}/api/jobs/${id}/resume`;
        
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) {
        console.log(id === 'all' ? 'Resumed all jobs.' : `Resumed job ${id}.`);
      } else {
        const errorText = await res.text();
        console.error(`Failed to resume: ${errorText}`);
      }
    } catch (err: any) {
      console.error(`Error communicating with daemon: ${err.message}`);
    }
  } else {
    // Offline Database fallback
    if (id === 'all') {
      const jobs = listJobs();
      let count = 0;
      for (const job of jobs) {
        if (job.status === 'paused' || job.status === 'failed') {
          job.status = 'queued';
          job.speed = 0;
          job.eta = -1;
          job.error = undefined;
          updateJob(job);
          saveResumeState(job);
          count++;
        }
      }
      console.log(`Resumed ${count} jobs (queued) in database.`);
    } else {
      const job = getJob(id);
      if (job) {
        if (job.status === 'paused' || job.status === 'failed') {
          job.status = 'queued';
          job.speed = 0;
          job.eta = -1;
          job.error = undefined;
          updateJob(job);
          saveResumeState(job);
          console.log(`Resumed job ${id} (queued) in database.`);
        } else {
          console.log(`Job ${id} is already ${job.status}.`);
        }
      } else {
        console.error(`Job with ID ${id} not found.`);
      }
    }
  }
}
