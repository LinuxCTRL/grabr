import { EventEmitter } from 'node:events';
import { renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import type { TorrentJob, TorrentFileInfo } from './types-torrent';
import { loadConfig, type GrabrConfig } from './config';
import type { WebTorrentInstance, Torrent } from 'webtorrent';
import { createTorrentJob, updateTorrentJob, listTorrentJobs, deleteTorrentJob } from '../store/torrents';

// Disable native binaries that cause Bun to crash due to unsupported libuv functions.
// Renaming them to .bak forces the modules (utp-native and fs-native-extensions)
// to catch load errors and safely fall back to pure JS/TCP operations.
function disableNativeBinaries() {
  try {
    // Disable utp-native
    try {
      const pkgPath = require.resolve('utp-native/package.json');
      const pkgDir = dirname(pkgPath);
      const platforms = ['linux-x64', 'win32-x64'];
      for (const plat of platforms) {
        const file = join(pkgDir, 'prebuilds', plat, 'node.napi.node');
        if (existsSync(file)) {
          renameSync(file, file + '.bak');
        }
      }
    } catch {}

    // Disable fs-native-extensions
    try {
      const pkgPath = require.resolve('fs-native-extensions/package.json');
      const pkgDir = dirname(pkgPath);
      const platforms = ['linux-x64', 'win32-x64'];
      for (const plat of platforms) {
        const file = join(pkgDir, 'prebuilds', plat, 'fs-native-extensions.node');
        if (existsSync(file)) {
          renameSync(file, file + '.bak');
        }
      }
    } catch {}
  } catch {}
}

disableNativeBinaries();

const stateDir = join(homedir(), '.grabr', 'torrents');

export class TorrentDownloader extends EventEmitter {
  private client: WebTorrentInstance | null = null;
  private activeJobs = new Map<string, TorrentJob>();
  private config: GrabrConfig;

  constructor() {
    super();
    this.config = loadConfig();
    mkdirSync(stateDir, { recursive: true });
  }

  private async getClient(): Promise<WebTorrentInstance> {
    if (this.client) return this.client;
    const WebTorrent = (await import('webtorrent')).default;
    const tc = this.config.torrent;
    this.client = new WebTorrent({
      dht: tc.dhtEnabled,
      tracker: tc.dhtEnabled,
      maxConns: tc.maxPeers,
      path: tc.downloadDir,
      natUpnp: false,
      natPmp: false,
    } as any);
    this.client.on('error', (err: any) => {
      console.error('WebTorrent client error:', err);
    });
    return this.client;
  }

  private decodeInput(input: string | Buffer): string | Buffer {
    if (typeof input === 'string' && input.startsWith('data:') && input.includes(';base64,')) {
      const parts = input.split(';base64,');
      const base64 = parts[1] || '';
      if (base64) return Buffer.from(base64, 'base64');
    }
    return input;
  }

  async add(input: string | Buffer, outputDir?: string): Promise<TorrentJob> {
    const dest = outputDir || this.config.outputDir;
    mkdirSync(dest, { recursive: true });

    const client = await this.getClient();

    let resolvedInput: string | Buffer = input;
    let savedInput: string = '';

    if (typeof input === 'string') {
      if (input.startsWith('data:') && input.includes(';base64,')) {
        const parts = input.split(';base64,');
        const base64 = parts[1] || '';
        if (base64) resolvedInput = Buffer.from(base64, 'base64');
        savedInput = input;
      } else if (input.startsWith('http://') || input.startsWith('https://')) {
        try {
          const response = await fetch(input);
          if (!response.ok) {
            throw new Error(`Failed to fetch torrent: HTTP ${response.status} ${response.statusText}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          resolvedInput = Buffer.from(arrayBuffer);
          savedInput = `data:application/x-bittorrent;base64,${resolvedInput.toString('base64')}`;
        } catch (err: any) {
          throw new Error(`Failed to download torrent URL: ${err.message}`);
        }
      } else {
        savedInput = input;
      }
    } else {
      resolvedInput = input;
      savedInput = `data:application/x-bittorrent;base64,${input.toString('base64')}`;
    }

    return new Promise((resolve, reject) => {
      const torrentId = nanoid(10);
      const startTime = Date.now();

      const addOpts: any = { path: dest };
      const trackers = this.config.torrent.trackers;
      if (trackers.length > 0) addOpts.announce = trackers;
      const torrent = client.add(resolvedInput, addOpts, (t: Torrent) => {
        const files: TorrentFileInfo[] = t.files.map((f) => ({
          path: f.path,
          length: f.length,
          downloaded: 0,
          selected: true,
        }));

        const tc = this.config.torrent;
        const job: TorrentJob = {
          id: torrentId,
          type: 'torrent',
          input: savedInput,
          infoHash: t.infoHash,
          name: t.name,
          files,
          totalLength: t.length,
          downloaded: 0,
          speed: 0,
          eta: -1,
          progress: 0,
          peers: t.numPeers,
          status: 'downloading',
          seedRatio: tc.seedRatio,
          seedTime: tc.seedTime,
          createdAt: startTime,
          updatedAt: Date.now(),
        };

        this.activeJobs.set(torrentId, job);
        createTorrentJob(job).catch(() => {});
        resolve(job);
      });

      this.attachTorrentEvents(torrent, torrentId);
    });
  }

  private async restore(job: TorrentJob): Promise<void> {
    const client = await this.getClient();
    const torrentId = job.id;

    this.activeJobs.set(torrentId, job);

    const addOpts: any = { path: this.config.outputDir };
    const trackers = this.config.torrent.trackers;
    if (trackers.length > 0) addOpts.announce = trackers;

    const resolvedInput = this.decodeInput(job.input);
    const torrent = client.add(resolvedInput, addOpts, (t: Torrent) => {
      job.infoHash = t.infoHash;
      job.name = t.name;
      job.totalLength = t.length;
      job.peers = t.numPeers;
      job.updatedAt = Date.now();

      // Restore file selection state
      for (let i = 0; i < job.files.length && i < t.files.length; i++) {
        const wf = t.files[i];
        if (wf && !job.files[i]?.selected) {
          wf.deselect();
        }
      }

      this.emit('torrent:progress', { jobId: torrentId, ...this.progressPayload(job) });
    });

    this.attachTorrentEvents(torrent, torrentId);
  }

  async loadPersistedJobs(): Promise<void> {
    const jobs = await listTorrentJobs();
    for (const job of jobs) {
      if (job.status === 'downloading' || job.status === 'paused') {
        this.restore(job).catch(() => {});
      }
    }
  }

  private attachTorrentEvents(torrent: Torrent, torrentId: string): void {
    torrent.on('download', (_bytes: number) => {
      const job = this.activeJobs.get(torrentId);
      if (!job) return;

      job.downloaded = torrent.downloaded;
      job.speed = torrent.downloadSpeed;
      job.progress = torrent.progress;
      job.peers = torrent.numPeers;
      job.updatedAt = Date.now();

      if (job.totalLength > 0) {
        const remaining = job.totalLength - job.downloaded;
        job.eta = job.speed > 0 ? Math.ceil(remaining / job.speed) : -1;
      }

      updateTorrentJob({ id: torrentId, downloaded: job.downloaded, status: job.status }).catch(() => {});

      this.emit('torrent:progress', { jobId: torrentId, ...this.progressPayload(job) });
    });

    torrent.on('done', () => {
      const job = this.activeJobs.get(torrentId);
      if (!job) return;

      job.status = 'seeding';
      job.progress = 1;
      job.downloaded = job.totalLength;
      job.speed = 0;
      job.updatedAt = Date.now();

      updateTorrentJob({ id: torrentId, status: job.status, downloaded: job.downloaded }).catch(() => {});

      this.emit('torrent:done', { jobId: torrentId });
    });

    torrent.on('error', (err: Error) => {
      const job = this.activeJobs.get(torrentId);
      if (job) {
        job.status = 'failed';
        job.error = err.message;
        job.updatedAt = Date.now();
        updateTorrentJob({ id: torrentId, status: job.status, error: job.error }).catch(() => {});
        this.emit('torrent:error', { jobId: torrentId, error: err.message });
      }
    });
  }

  private progressPayload(job: TorrentJob) {
    return {
      downloaded: job.downloaded,
      totalLength: job.totalLength,
      speed: job.speed,
      eta: job.eta,
      progress: job.progress,
      peers: job.peers,
    };
  }

  pause(jobId: string) {
    if (!this.client) return;
    const clientTorrent = this.client.torrents.find(
      (t) => this.activeJobs.get(jobId)?.infoHash === t.infoHash
    );
    if (clientTorrent) {
      clientTorrent.destroy();
    }
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'paused';
      // Reset speed and ETA when paused
      job.speed = 0;
      job.eta = -1;
      updateTorrentJob({ id: jobId, status: 'paused' }).catch(() => {});
      this.emit('torrent:status', { jobId, status: 'paused' });
    }
  }

  resume(jobId: string) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'downloading';
      updateTorrentJob({ id: jobId, status: 'downloading' }).catch(() => {});
      this.emit('torrent:status', { jobId, status: 'downloading' });
      this.restore(job).catch(() => {});
    }
  }

  remove(jobId: string) {
    if (this.client) {
      const clientTorrent = this.client.torrents.find(
        (t) => this.activeJobs.get(jobId)?.infoHash === t.infoHash
      );
      if (clientTorrent) {
        clientTorrent.destroy();
      }
    }
    this.activeJobs.delete(jobId);
    deleteTorrentJob(jobId).catch(() => {});
    this.emit('torrent:removed', jobId);
  }

  async selectFiles(jobId: string, indices: number[], selected: boolean): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) throw new Error(`Torrent job not found: ${jobId}`);

    if (!this.client) return;
    const clientTorrent = this.client.torrents.find((t) => t.infoHash === job.infoHash);
    if (!clientTorrent) throw new Error(`WebTorrent instance not found for job: ${jobId}`);

    const sequential = this.config.torrent.sequentialDownload;
    for (const i of indices) {
      const wf = clientTorrent.files[i];
      if (!wf) continue;
      if (selected) wf.select(sequential);
      else wf.deselect();
      const jf = job.files[i];
      if (jf) jf.selected = selected;
    }

    job.updatedAt = Date.now();
    await updateTorrentJob({ id: jobId, files: job.files });
    this.emit('torrent:files', { jobId, files: job.files });
  }

  getFileStream(jobId: string, fileIndex: number, range?: { start?: number; end?: number }): NodeJS.ReadableStream | null {
    if (!this.client) return null;
    const job = this.activeJobs.get(jobId);
    if (!job) return null;
    const clientTorrent = this.client.torrents.find((t) => t.infoHash === job.infoHash);
    if (!clientTorrent) return null;
    const wf = clientTorrent.files[fileIndex];
    if (!wf) return null;
    return wf.createReadStream(range);
  }

  getJob(jobId: string): TorrentJob | undefined {
    return this.activeJobs.get(jobId);
  }

  listJobs(): TorrentJob[] {
    return Array.from(this.activeJobs.values());
  }

  stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

export function isTorrentInput(input: string): boolean {
  return (
    input.startsWith('magnet:') ||
    input.startsWith('data:') ||
    input.endsWith('.torrent') ||
    input.includes('.torrent')
  );
}
