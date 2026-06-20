import { listJobs } from '../../store/jobs';
import { loadConfig } from '../../core/config';
import { formatBytes, formatSpeed, formatETA } from '../ui/utils';
import type { DownloadJob } from '../../core/types';

async function getJobsFromDaemon(port = 7474): Promise<DownloadJob[] | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, {
      signal: AbortSignal.timeout(500),
    });
    if (res.ok) {
      return (await res.json()) as DownloadJob[];
    }
    return null;
  } catch {
    return null;
  }
}

export async function listCommand() {
  const config = loadConfig();
  const port = config.serverPort;

  let jobs: DownloadJob[] = [];
  const daemonJobs = await getJobsFromDaemon(port);

  if (daemonJobs) {
    jobs = daemonJobs;
  } else {
    jobs = await listJobs();
  }

  if (jobs.length === 0) {
    console.log('No downloads found.');
    return;
  }

  // Format and print header
  const pad = (str: string, width: number) => {
    if (str.length > width) return str.slice(0, width - 3) + '...';
    return str.padEnd(width);
  };

  console.log(
    ` ${pad('ID', 12)} ${pad('FILENAME', 30)} ${pad('STATUS', 15)} ${pad('PROGRESS', 12)} ${pad('SPEED', 12)} ${pad('ETA', 12)}`
  );
  console.log('—'.repeat(99));

  for (const job of jobs) {
    const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
    const progressStr = `${Math.round(percent)}% (${formatBytes(job.downloadedBytes)}/${job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'})`;
    
    let etaStr = '--';
    if (job.status === 'downloading') {
      etaStr = formatETA(job.eta).replace('ETA ', '');
    }

    const speedStr = job.status === 'downloading' ? formatSpeed(job.speed) : '0 B/s';

    console.log(
      ` ${pad(job.id, 12)} ${pad(job.filename, 30)} ${pad(job.status.toUpperCase(), 15)} ${pad(progressStr, 12)} ${pad(speedStr, 12)} ${pad(etaStr, 12)}`
    );
  }
}
