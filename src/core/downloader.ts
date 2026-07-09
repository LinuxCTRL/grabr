import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { getFileMetadata } from './chunker';
import { downloadChunk } from './worker';
import { mergeChunks } from './merger';
import { saveResumeState, deleteResumeState, loadResumeState } from './resume';
import { createJob, updateJob, getJob, listJobs, deleteJob } from '../store/jobs';
import { updateTorrentJob, listTorrentJobs } from '../store/torrents';
import { loadConfig, type GrabrConfig } from './config';
import { isYouTubeUrl, getYouTubeMetadata } from './youtube';
import { TorrentDownloader, isTorrentInput } from './torrent-downloader';
import type { TorrentJob } from './types-torrent';
import type { DownloadJob, ChunkInfo, JobStatus, DownloadOptions } from './types';

export class SpeedMeter {
  private ema = 0;
  private alpha = 0.2;
  private lastTime = Date.now();
  private lastBytes = 0;

  constructor(initialBytes = 0) {
    this.lastBytes = initialBytes;
  }

  update(totalBytes: number): number {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    const db = totalBytes - this.lastBytes;

    const instantSpeed = db > 0 && dt > 0 ? db / dt : 0;

    if (dt > 0) {
      this.ema = this.alpha * instantSpeed + (1 - this.alpha) * this.ema;
      this.lastTime = now;
      this.lastBytes = totalBytes;
    }
    return this.ema;
  }

  get bytesPerSec(): number {
    return this.ema;
  }
}

function resolveFilenameCollision(destination: string, filename: string): string {
  let finalPath = join(destination, filename);
  if (!existsSync(finalPath)) {
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  const name = dotIndex !== -1 ? filename.slice(0, dotIndex) : filename;
  const ext = dotIndex !== -1 ? filename.slice(dotIndex) : '';

  let counter = 1;
  while (true) {
    const newFilename = `${name}(${counter})${ext}`;
    finalPath = join(destination, newFilename);
    if (!existsSync(finalPath)) {
      return newFilename;
    }
    counter++;
  }
}

export class Downloader extends EventEmitter {
  private activeJobs = new Map<
    string,
    {
      job: DownloadJob;
      abortController: AbortController;
      speedMeter: SpeedMeter;
    }
  >();
  private torrentDownloader: TorrentDownloader;
  private config: GrabrConfig;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.config = loadConfig();
    this.torrentDownloader = new TorrentDownloader();

    // Relay torrent events through the main Downloader
    this.torrentDownloader.on('torrent:progress', (data) => {
      this.emit('torrent:progress', data);
    });
    this.torrentDownloader.on('torrent:done', (data) => {
      this.emit('torrent:done', data);
    });
    this.torrentDownloader.on('torrent:error', (data) => {
      this.emit('torrent:error', data);
    });
    this.torrentDownloader.on('torrent:status', (data) => {
      this.emit('torrent:status', data);
    });
    this.torrentDownloader.on('torrent:removed', (data) => {
      this.emit('torrent:removed', data);
    });
  }

  private async resetInterruptedJobs() {
    try {
      const jobs = await listJobs();
      for (const job of jobs) {
        if (job.status === 'downloading') {
          job.status = 'paused';
          job.speed = 0;
          await updateJob(job);
          saveResumeState(job);
        }
      }
    } catch (err) {
      // Ignore database or bootstrap issues
    }
  }

  private async resetInterruptedTorrents() {
    try {
      const jobs = await listTorrentJobs();
      for (const job of jobs) {
        if (job.status === 'downloading') {
          job.status = 'paused';
          await updateTorrentJob({ id: job.id, status: 'paused' });
        }
      }
    } catch (_err) {
      // Ignore
    }
  }

  public async start() {
    if (this.intervalTimer) return;

    await this.resetInterruptedJobs();
    await this.resetInterruptedTorrents();
    await this.torrentDownloader.loadPersistedJobs();

    // Start background stats updater running every 500ms
    this.intervalTimer = setInterval(() => {
      this.updateStats().catch(() => {});
    }, 500);

    this.processQueue();
  }

  public stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    // Pause all running downloads synchronously (abort controllers)
    for (const jobId of this.activeJobs.keys()) {
      const active = this.activeJobs.get(jobId);
      if (active) {
        active.abortController.abort();
      }
      this.activeJobs.delete(jobId);
    }
    this.torrentDownloader.stop();
  }

  private async updateStats() {
    for (const [jobId, active] of this.activeJobs.entries()) {
      const { job, speedMeter } = active;
      const speed = speedMeter.update(job.downloadedBytes);
      job.speed = Math.round(speed);

      if (job.totalBytes > 0) {
        const remainingBytes = job.totalBytes - job.downloadedBytes;
        job.eta = speed > 0 ? Math.ceil(remainingBytes / speed) : -1;
      } else {
        job.eta = -1;
      }

      job.updatedAt = Date.now();

      await updateJob(job);
      saveResumeState(job);

      this.emit('job:progress', {
        jobId: job.id,
        downloadedBytes: job.downloadedBytes,
        totalBytes: job.totalBytes,
        speed: job.speed,
        eta: job.eta,
        chunks: job.chunks,
      });
    }
  }

  public async addJob(url: string, options?: DownloadOptions): Promise<DownloadJob | TorrentJob> {
    const outputDir = options?.outputDir || this.config.outputDir;

    mkdirSync(outputDir, { recursive: true });

    // Route torrent inputs to the torrent downloader
    if (isTorrentInput(url)) {
      try {
        const torrentJob = await this.torrentDownloader.add(url, outputDir);
        this.emit('job:added', torrentJob);
        return torrentJob;
      } catch (err: any) {
        throw new Error(`Torrent error: ${err.message}`);
      }
    }

    const numChunks = options?.chunks || this.config.defaultChunks;
    
    let metadata;
    if (isYouTubeUrl(url)) {
      const ytMeta = await getYouTubeMetadata(url);
      metadata = {
        filename: options?.filename || ytMeta.filename,
        totalBytes: ytMeta.totalBytes,
        acceptRanges: false,
        chunks: [
          {
            index: 0,
            start: 0,
            end: ytMeta.totalBytes > 0 ? ytMeta.totalBytes - 1 : 0,
            downloaded: 0,
            status: 'pending' as const,
          }
        ]
      };
    } else {
      metadata = await getFileMetadata(url, numChunks, options?.filename);
    }

    const filename = resolveFilenameCollision(outputDir, metadata.filename);

    const job: DownloadJob = {
      id: nanoid(10),
      url,
      filename,
      destination: outputDir,
      totalBytes: metadata.totalBytes,
      downloadedBytes: 0,
      chunks: metadata.chunks,
      status: 'queued',
      speed: 0,
      eta: -1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await createJob(job);
    saveResumeState(job);

    this.emit('job:added', job);

    process.nextTick(() => this.processQueue());

    return job;
  }

  public async pauseJob(jobId: string) {
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.abortController.abort();
      this.activeJobs.delete(jobId);
    }

    // Check if it's a torrent job
    const torrentJob = this.torrentDownloader.getJob(jobId);
    if (torrentJob) {
      this.torrentDownloader.pause(jobId);
      return;
    }

    const job = await getJob(jobId);
    if (job && (job.status === 'downloading' || job.status === 'queued')) {
      job.status = 'paused';
      job.speed = 0;
      job.eta = -1;
      job.updatedAt = Date.now();
      await updateJob(job);
      saveResumeState(job);
      this.emit('job:status', { jobId, status: 'paused' });
    }

    this.processQueue();
  }

  public async resumeJob(jobId: string) {
    // Check if it's a torrent job
    const torrentJob = this.torrentDownloader.getJob(jobId);
    if (torrentJob) {
      this.torrentDownloader.resume(jobId);
      return;
    }

    const job = await getJob(jobId);
    if (job && (job.status === 'paused' || job.status === 'failed')) {
      job.status = 'queued';
      job.speed = 0;
      job.eta = -1;
      job.error = undefined;
      job.updatedAt = Date.now();
      await updateJob(job);
      saveResumeState(job);
      this.emit('job:status', { jobId, status: 'queued' });
    }

    this.processQueue();
  }

  public async removeJob(jobId: string) {
    const torrentJob = this.torrentDownloader.getJob(jobId);
    if (torrentJob) {
      this.torrentDownloader.remove(jobId);
      return;
    }

    await this.pauseJob(jobId);
    await deleteJob(jobId);
    deleteResumeState(jobId);
    this.emit('job:removed', jobId);
  }

  public async pauseAll() {
    const jobs = await listJobs();
    for (const job of jobs) {
      if (job.status === 'downloading' || job.status === 'queued') {
        await this.pauseJob(job.id);
      }
    }
  }

  public async resumeAll() {
    const jobs = await listJobs();
    for (const job of jobs) {
      if (job.status === 'paused' || job.status === 'failed') {
        await this.resumeJob(job.id);
      }
    }
  }

  public listTorrentJobs(): TorrentJob[] {
    return this.torrentDownloader.listJobs();
  }

  public async selectTorrentFiles(jobId: string, indices: number[], selected: boolean): Promise<void> {
    await this.torrentDownloader.selectFiles(jobId, indices, selected);
  }

  public getTorrentFileStream(jobId: string, fileIndex: number, range?: { start?: number; end?: number }): NodeJS.ReadableStream | null {
    return this.torrentDownloader.getFileStream(jobId, fileIndex, range);
  }

  private async processQueue() {
    const activeCount = this.activeJobs.size;
    const slotsAvailable = this.config.maxConcurrent - activeCount;
    if (slotsAvailable <= 0) return;

    const jobs = await listJobs();
    const queuedJobs = jobs.filter((j) => j.status === 'queued');

    for (let i = 0; i < Math.min(slotsAvailable, queuedJobs.length); i++) {
      const job = queuedJobs[i];
      if (job && !this.activeJobs.has(job.id)) {
        this.runJob(job).catch(() => {});
      }
    }
  }

  private async runJob(job: DownloadJob): Promise<void> {
    const abortController = new AbortController();

    if (isYouTubeUrl(job.url)) {
      return this.runYouTubeJob(job, abortController);
    }

    const speedMeter = new SpeedMeter(job.downloadedBytes);

    job.status = 'downloading';
    job.updatedAt = Date.now();
    await updateJob(job);
    saveResumeState(job);
    this.emit('job:status', { jobId: job.id, status: 'downloading' });

    this.activeJobs.set(job.id, { job, abortController, speedMeter });

    const tmpDir = join(homedir(), '.grabr', 'tmp', job.id);
    const partPaths: string[] = [];

    try {
      const downloadPromises = job.chunks.map(async (chunk) => {
        const partPath = join(tmpDir, `${chunk.index}.part`);
        partPaths.push(partPath);

        if (chunk.status === 'done') {
          return;
        }

        chunk.status = 'downloading';

        let attempt = 0;
        const maxRetries = 3;
        while (true) {
          try {
            await downloadChunk(
              job.url,
              chunk,
              partPath,
              (bytes) => {
                job.downloadedBytes += bytes;
              },
              abortController.signal
            );
            break;
          } catch (err: any) {
            if (abortController.signal.aborted || err.name === 'AbortError') {
              throw err;
            }
            attempt++;
            if (attempt >= maxRetries) {
              throw err;
            }
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, delay);
              abortController.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          }
        }
      });

      await Promise.all(downloadPromises);

      if (abortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const finalDest = join(job.destination, job.filename);
      await mergeChunks(partPaths, finalDest, tmpDir);

      job.status = 'completed';
      job.speed = 0;
      job.eta = 0;
      job.downloadedBytes = job.totalBytes;
      job.updatedAt = Date.now();

      await updateJob(job);
      deleteResumeState(job.id);

      this.activeJobs.delete(job.id);
      this.emit('job:status', { jobId: job.id, status: 'completed' });

    } catch (err: any) {
      this.activeJobs.delete(job.id);

      if (abortController.signal.aborted || err.name === 'AbortError') {
        return;
      }

      job.status = 'failed';
      job.speed = 0;
      job.eta = -1;
      job.error = err.message || 'Unknown download error';
      job.updatedAt = Date.now();

      for (const chunk of job.chunks) {
        if (chunk.status === 'downloading') {
          chunk.status = 'failed';
        }
      }

      await updateJob(job);
      saveResumeState(job);

      this.emit('job:status', { jobId: job.id, status: 'failed', error: job.error });
    } finally {
      this.processQueue();
    }
  }

  private async runYouTubeJob(job: DownloadJob, abortController: AbortController): Promise<void> {
    job.status = 'downloading';
    job.updatedAt = Date.now();
    await updateJob(job);
    saveResumeState(job);
    this.emit('job:status', { jobId: job.id, status: 'downloading' });

    this.activeJobs.set(job.id, { job, abortController, speedMeter: new SpeedMeter() });

    try {
      const finalDest = join(job.destination, job.filename);
      
      // Extract format selection from URL hash (transparent config channel)
      let formatSelection = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
      if (job.url.includes('#format=')) {
        const parts = job.url.split('#format=');
        formatSelection = decodeURIComponent(parts[1] || '');
      }
      
      const cleanUrl = job.url.split('#')[0] || '';
      
      const child: any = spawn('yt-dlp', [
        '-f', formatSelection,
        '--merge-output-format', 'mp4',
        '-o', finalDest,
        '--newline',
        cleanUrl
      ]);

      abortController.signal.addEventListener('abort', () => {
        child.kill();
      });

      let stderr = '';

      child.stderr.on('data', (data: any) => {
        stderr += data.toString();
      });

      child.stdout.on('data', async (data: any) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.includes('[download]')) continue;

          // Parse percent
          const pctMatch = line.match(/([\d.]+)%/);
          const percent = pctMatch ? parseFloat(pctMatch[1]) : 0;

          // Parse total size if we don't have it
          if (job.totalBytes === 0) {
            const sizeMatch = line.match(/of\s+(?:~)?([\d.]+)(KiB|MiB|GiB|B)/);
            if (sizeMatch) {
              const val = parseFloat(sizeMatch[1]);
              const unit = sizeMatch[2];
              let sizeBytes = 0;
              if (unit === 'KiB') sizeBytes = val * 1024;
              else if (unit === 'MiB') sizeBytes = val * 1024 * 1024;
              else if (unit === 'GiB') sizeBytes = val * 1024 * 1024 * 1024;
              else sizeBytes = val;
              job.totalBytes = Math.round(sizeBytes);
              if (job.chunks[0]) {
                job.chunks[0].end = job.totalBytes > 0 ? job.totalBytes - 1 : 0;
              }
            }
          }

          // Parse speed
          const speedMatch = line.match(/at\s+([\d.]+)(KiB|MiB|GiB|B)\/s/);
          let speedBytes = 0;
          if (speedMatch) {
            const val = parseFloat(speedMatch[1]);
            const unit = speedMatch[2];
            if (unit === 'KiB') speedBytes = val * 1024;
            else if (unit === 'MiB') speedBytes = val * 1024 * 1024;
            else if (unit === 'GiB') speedBytes = val * 1024 * 1024 * 1024;
            else speedBytes = val;
          }

          // Parse ETA
          const etaMatch = line.match(/ETA\s+([\d:]+)/);
          let etaSeconds = -1;
          if (etaMatch) {
            const parts = etaMatch[1].split(':').map(Number);
            if (parts.length === 2) {
              etaSeconds = parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
              etaSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
          }

          // Update downloadedBytes
          if (percent > 0 && job.totalBytes > 0) {
            job.downloadedBytes = Math.round((percent / 100) * job.totalBytes);
            if (job.chunks[0]) {
              job.chunks[0].downloaded = job.downloadedBytes;
              if (percent >= 100) {
                job.chunks[0].status = 'done';
              } else {
                job.chunks[0].status = 'downloading';
              }
            }
          }

          job.speed = Math.round(speedBytes);
          job.eta = etaSeconds;
          job.updatedAt = Date.now();

          await updateJob(job);
          saveResumeState(job);

          this.emit('job:progress', {
            jobId: job.id,
            downloadedBytes: job.downloadedBytes,
            totalBytes: job.totalBytes,
            speed: job.speed,
            eta: job.eta,
            chunks: job.chunks,
          });
        }
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      this.activeJobs.delete(job.id);

      if (abortController.signal.aborted) {
        return;
      }

      if (exitCode !== 0) {
        throw new Error(`yt-dlp failed: ${stderr.trim() || 'Exit code ' + exitCode}`);
      }

      job.status = 'completed';
      job.speed = 0;
      job.eta = 0;
      job.downloadedBytes = job.totalBytes;
      job.updatedAt = Date.now();
      if (job.chunks[0]) {
        job.chunks[0].status = 'done';
        job.chunks[0].downloaded = job.totalBytes;
      }

      await updateJob(job);
      deleteResumeState(job.id);

      this.emit('job:status', { jobId: job.id, status: 'completed' });

    } catch (err: any) {
      this.activeJobs.delete(job.id);

      if (abortController.signal.aborted) {
        return;
      }

      job.status = 'failed';
      job.speed = 0;
      job.eta = -1;
      job.error = err.message || 'Unknown YouTube download error';
      job.updatedAt = Date.now();
      if (job.chunks[0]) {
        job.chunks[0].status = 'failed';
      }

      await updateJob(job);
      saveResumeState(job);

      this.emit('job:status', { jobId: job.id, status: 'failed', error: job.error });
    } finally {
      this.processQueue();
    }
  }
}