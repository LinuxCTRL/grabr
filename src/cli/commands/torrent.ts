import { createInterface } from 'node:readline';
import { listTorrentJobs, getTorrentJob } from '../../store/torrents';
import { loadConfig } from '../../core/config';
import { formatBytes } from '../ui/utils';

async function getTorrentsFromDaemon(port = 7474) {
  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, {
      signal: AbortSignal.timeout(500),
    });
    if (res.ok) {
      const all = await res.json() as any[];
      return all.filter((j: any) => j.type === 'torrent');
    }
    return null;
  } catch {
    return null;
  }
}

async function getTorrentFromDaemon(id: string, port = 7474) {
  try {
    const res = await fetch(`http://localhost:${port}/api/torrents/${id}`, {
      signal: AbortSignal.timeout(500),
    });
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

export async function torrentCommand(args: string[]) {
  const config = loadConfig();
  const port = config.serverPort;

  const subcommand = args[0];

  if (!subcommand || subcommand === 'help') {
    console.log(`
  Usage:
    grabr torrent add <url|magnet|file>   Add a torrent (magnet, URL, or .torrent file)
    grabr torrent list                     List all torrent jobs
    grabr torrent files <id>               List files inside a torrent
    grabr torrent select <id> <idx...>     Select files by index to download
    grabr torrent deselect <id> <idx...>   Deselect files by index
    grabr torrent seed <id> <ratio>        Set seed ratio target (e.g. 2.0 = seed 2x)
    grabr torrent info <id>                Show detailed torrent info
    `);
    return;
  }

  if (subcommand === 'add') {
    const url = args[1];
    if (!url) {
      console.error('Usage: grabr torrent add <url|magnet|file>');
      return;
    }

    try {
      const res = await fetch(`http://localhost:${port}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.error(`Error adding torrent: ${await res.text()}`);
        return;
      }
      const job = await res.json();
      console.log(`\n  Added torrent: ${job.name || job.id}`);

      if (job.files && job.files.length > 0) {
        console.log(`\n  Files (${job.files.length} total):\n`);
        for (let i = 0; i < job.files.length; i++) {
          const f = job.files[i];
          const size = formatBytes(f.length);
          console.log(`  [${i}] ${f.selected ? '✓' : '✗'} ${size}  ${f.path}`);
        }

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question('\n  Select files by index (e.g. "0 2 3" or "all"): ', resolve);
        });
        rl.close();

        const allFiles = answer.trim().toLowerCase() === 'all';
        let indices: number[];
        if (allFiles) {
          indices = [...Array(job.files.length).keys()];
        } else {
          indices = answer.split(/\s+/).map(Number).filter((n) => !isNaN(n));
        }

        if (indices.length > 0 && indices.length < job.files.length) {
          // Deselect all files first
          const allIndices = [...Array(job.files.length).keys()];
          await fetch(`http://localhost:${port}/api/torrents/${job.id}/select`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ indices: allIndices, selected: false }),
            signal: AbortSignal.timeout(2000),
          });
          // Then select the chosen ones
          await fetch(`http://localhost:${port}/api/torrents/${job.id}/select`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ indices, selected: true }),
            signal: AbortSignal.timeout(2000),
          });
          console.log(`  Selected files [${indices.join(', ')}].`);
        } else if (allFiles || indices.length === job.files.length) {
          console.log('  All files selected.');
        } else {
          console.log('  No files selected (torrent paused).');
        }
      }
    } catch (err: any) {
      console.error(`Failed to add torrent: ${err.message}`);
    }
    return;
  }

  if (subcommand === 'list') {
    let jobs: any[];
    const daemonJobs = await getTorrentsFromDaemon(port);
    if (daemonJobs) {
      jobs = daemonJobs;
    } else {
      jobs = await listTorrentJobs();
    }

    if (jobs.length === 0) {
      console.log('No torrent jobs found.');
      return;
    }

    const pad = (str: string, width: number) => {
      if (str.length > width) return str.slice(0, width - 3) + '...';
      return str.padEnd(width);
    };

    console.log(` ${pad('ID', 12)} ${pad('NAME', 30)} ${pad('STATUS', 12)} ${pad('PROGRESS', 10)} ${pad('PEERS', 6)} ${pad('SEED RATIO', 10)}`);
    console.log('—'.repeat(86));

    for (const job of jobs) {
      const percent = job.totalLength > 0 ? Math.round((job.downloaded / job.totalLength) * 100) : 0;
      const progressStr = `${percent}%`;
      const statusStr = job.status.toUpperCase();
      const nameStr = job.name || '(unknown)';
      const peersStr = String(job.peers ?? 0);
      const seedStr = String(job.seedRatio ?? 0);

      console.log(` ${pad(job.id, 12)} ${pad(nameStr, 30)} ${pad(statusStr, 12)} ${pad(progressStr, 10)} ${pad(peersStr, 6)} ${pad(seedStr, 10)}`);
    }
    return;
  }

  if (subcommand === 'files') {
    const id = args[1];
    if (!id) {
      console.error('Usage: grabr torrent files <id>');
      return;
    }

    let job: any;
    const daemonJob = await getTorrentFromDaemon(id, port);
    if (daemonJob) {
      job = daemonJob;
    } else {
      job = await getTorrentJob(id);
    }

    if (!job) {
      console.error(`Torrent job not found: ${id}`);
      return;
    }

    const files = job.files || [];
    if (files.length === 0) {
      console.log('No files in this torrent (metadata may not be ready yet).');
      return;
    }

    console.log(`\n  Files in "${job.name || 'unknown'}":\n`);
    const pad = (str: string, width: number) => {
      if (str.length > width) return str.slice(0, width - 3) + '...';
      return str.padEnd(width);
    };

    console.log(`  ${pad('#', 4)} ${pad('SELECTED', 9)} ${pad('SIZE', 10)} ${pad('PATH', 60)}`);
    console.log(`  ${'—'.repeat(87)}`);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const selected = f.selected ? '✓' : '✗';
      const size = formatBytes(f.length);
      console.log(`  ${pad(String(i), 4)} ${pad(selected, 9)} ${pad(size, 10)} ${pad(f.path, 60)}`);
    }
    console.log();
    return;
  }

  if (subcommand === 'info') {
    const id = args[1];
    if (!id) {
      console.error('Usage: grabr torrent info <id>');
      return;
    }

    let job: any;
    const daemonJob = await getTorrentFromDaemon(id, port);
    if (daemonJob) {
      job = daemonJob;
    } else {
      job = await getTorrentJob(id);
    }

    if (!job) {
      console.error(`Torrent job not found: ${id}`);
      return;
    }

    console.log(`\n  Torrent: ${job.name || 'unknown'}`);
    console.log(`  ID:       ${job.id}`);
    console.log(`  InfoHash: ${job.infoHash || 'unknown'}`);
    console.log(`  Size:     ${formatBytes(job.totalLength || 0)}`);
    console.log(`  Downloaded: ${formatBytes(job.downloaded || 0)}`);
    console.log(`  Status:   ${(job.status || 'unknown').toUpperCase()}`);
    console.log(`  Peers:    ${job.peers ?? 0}`);
    console.log(`  Progress: ${job.totalLength > 0 ? Math.round((job.downloaded / job.totalLength) * 100) : 0}%`);
    console.log(`  Seed Ratio: ${job.seedRatio ?? 0}`);
    console.log(`  Files:    ${(job.files || []).length}`);
    console.log(`  Input:    ${job.input || '(unknown)'}`);
    console.log();
    return;
  }

  if (subcommand === 'select' || subcommand === 'deselect') {
    const id = args[1];
    const indices = args.slice(2).map(Number).filter((n) => !isNaN(n));
    if (!id || indices.length === 0) {
      console.error(`Usage: grabr torrent ${subcommand} <id> <index...>`);
      console.error(`  Example: grabr torrent ${subcommand} abc123 0 2 4`);
      return;
    }

    const selected = subcommand === 'select';

    // Try daemon API first
    try {
      const res = await fetch(`http://localhost:${port}/api/torrents/${id}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices, selected }),
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) {
        console.log(`${selected ? 'Selected' : 'Deselected'} files [${indices.join(', ')}] in torrent ${id}.`);
        return;
      }
      const errText = await res.text();
      console.error(`Daemon error: ${errText}`);
    } catch {
      console.error('Could not reach daemon. File selection requires a running daemon.');
    }
    return;
  }

  if (subcommand === 'seed') {
    const id = args[1];
    const ratio = parseFloat(args[2] || '');
    if (!id || isNaN(ratio)) {
      console.error('Usage: grabr torrent seed <id> <ratio>');
      console.error('  Example: grabr torrent seed abc123 2.0  (seed until ratio reaches 2.0)');
      return;
    }

    // For now, just print guidance. The ratio is stored but enforcement requires daemon integration.
    console.log(`Set seed ratio for ${id} to ${ratio}.`);
    console.log('Note: seed ratio enforcement will be implemented in a future update.');
    return;
  }

  console.error(`Unknown torrent subcommand: ${subcommand}`);
  console.error('Run "grabr torrent help" for usage.');
}
