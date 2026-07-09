import { listJobs } from '../../store/jobs';
import { listTorrentJobs } from '../../store/torrents';
import { loadConfig } from '../../core/config';
import { formatBytes, formatSpeed, formatETA } from '../ui/utils';
import type { DownloadJob } from '../../core/types';
import type { TorrentJob } from '../../core/types-torrent';

function isTorrentJob(j: any): j is TorrentJob {
  return j?.type === 'torrent';
}

async function getJobsFromDaemon(port = 7474): Promise<{ http: DownloadJob[]; torrent: TorrentJob[] } | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, { signal: AbortSignal.timeout(500) });
    if (res.ok) {
      const all = await res.json() as any[];
      return {
        http: all.filter((j) => !isTorrentJob(j)) as DownloadJob[],
        torrent: all.filter(isTorrentJob) as TorrentJob[],
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function listCommand() {
  const config = loadConfig();
  const port = config.serverPort;

  let httpJobs: DownloadJob[] = [];
  let torrentJobs: TorrentJob[] = [];

  const daemonJobs = await getJobsFromDaemon(port);
  if (daemonJobs) {
    httpJobs = daemonJobs.http;
    torrentJobs = daemonJobs.torrent;
  } else {
    httpJobs = await listJobs();
    torrentJobs = await listTorrentJobs();
  }

  const allJobs = [...httpJobs, ...torrentJobs];

  if (allJobs.length === 0) {
    console.log('No downloads found.');
    return;
  }

  const pad = (str: string, width: number) => {
    if (str.length > width) return str.slice(0, width - 3) + '...';
    return str.padEnd(width);
  };

  console.log(
    ` ${pad('ID', 12)} ${pad('NAME', 30)} ${pad('STATUS', 15)} ${pad('PROGRESS', 12)} ${pad('SPEED', 12)} ${pad('ETA', 12)}`
  );
  console.log('—'.repeat(99));

  for (const job of allJobs) {
    let name: string;
    let totalBytes: number;
    let downloadedBytes: number;
    let status: string;
    let speed: number;
    let eta: number;

    if ('type' in job && job.type === 'torrent') {
      const t = job as TorrentJob;
      name = t.name;
      totalBytes = t.totalLength;
      downloadedBytes = t.downloaded;
      status = t.status;
      speed = t.speed;
      eta = t.eta;
    } else {
      const d = job as DownloadJob;
      name = d.filename;
      totalBytes = d.totalBytes;
      downloadedBytes = d.downloadedBytes;
      status = d.status;
      speed = d.speed;
      eta = d.eta;
    }

    const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
    const progressStr = `${Math.round(percent)}% (${formatBytes(downloadedBytes)}/${totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'})`;

    let etaStr = '--';
    if (status === 'downloading') {
      etaStr = formatETA(eta).replace('ETA ', '');
    }

    const speedStr = status === 'downloading' ? formatSpeed(speed) : '0 B/s';

    console.log(
      ` ${pad(job.id, 12)} ${pad(name, 30)} ${pad(status.toUpperCase(), 15)} ${pad(progressStr, 12)} ${pad(speedStr, 12)} ${pad(etaStr, 12)}`
    );
  }
}
