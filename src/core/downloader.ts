import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { getFileMetadata } from './chunker';
import { downloadChunk } from './worker';
import { mergeChunks } from './merger';
import { saveResumeState, deleteResumeState, loadResumeState } from './resume';
import { createJob, updateJob, getJob, listJobs, deleteJob } from '../store/jobs';
import { loadConfig, type GrabrConfig } from './config';
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
  private config: GrabrConfig;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.config = loadConfig();
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

  public async start() {
    if (this.intervalTimer) return;

    await this.resetInterruptedJobs();

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

  public async addJob(url: string, options?: DownloadOptions): Promise<DownloadJob> {
    const outputDir = options?.outputDir || this.config.outputDir;

    mkdirSync(outputDir, { recursive: true });

    const numChunks = options?.chunks || this.config.defaultChunks;
    const metadata = await getFileMetadata(url, numChunks, options?.filename);

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
    const speedMeter = new SpeedMeter(job.downloadedBytes);

    job.status = 'downloading';
    job.updatedAt = Date.now();
    await updateJob(job);
    saveResumeState(job);
    this.emit('job:status', { jobId: job.id, status: 'downloading' });

    this.activeJobs.set(job.id, { job, abortController, speedMeter });

    const tmpDir = join(process.cwd(), '.grabr', 'tmp', job.id);
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
}