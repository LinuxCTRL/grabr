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
  private alpha = 0.2; // smoothing factor
  private lastTime = Date.now();
  private lastBytes = 0;

  constructor(initialBytes = 0) {
    this.lastBytes = initialBytes;
  }

  update(totalBytes: number): number {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    const db = totalBytes - this.lastBytes;
    
    // Avoid infinity or negative speeds
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
  private intervalTimer: Timer | null = null;

  constructor() {
    super();
    this.config = loadConfig();
    this.resetInterruptedJobs();
  }

  private resetInterruptedJobs() {
    try {
      const jobs = listJobs();
      for (const job of jobs) {
        if (job.status === 'downloading') {
          job.status = 'paused';
          job.speed = 0;
          updateJob(job);
          saveResumeState(job);
        }
      }
    } catch (err) {
      // Ignore database or bootstrap issues
    }
  }

  public start() {
    if (this.intervalTimer) return;

    // Start background stats updater running every 500ms
    this.intervalTimer = setInterval(() => {
      this.updateStats();
    }, 500);

    this.processQueue();
  }

  public stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    // Pause all running downloads
    for (const jobId of this.activeJobs.keys()) {
      this.pauseJob(jobId);
    }
  }

  private updateStats() {
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
      
      // Update database and write backup resume file
      updateJob(job);
      saveResumeState(job);

      // Emit progress
      this.emit('job:progress', {
        jobId: job.id,
        downloadedBytes: job.downloadedBytes,
        speed: job.speed,
        eta: job.eta,
      });
    }
  }

  public async addJob(url: string, options?: DownloadOptions): Promise<DownloadJob> {
    const outputDir = options?.outputDir || this.config.outputDir;
    
    // Ensure destination directory exists
    mkdirSync(outputDir, { recursive: true });

    // Fetch file metadata
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

    createJob(job);
    saveResumeState(job);

    this.emit('job:added', job);
    
    // Process queue in next tick
    process.nextTick(() => this.processQueue());

    return job;
  }

  public pauseJob(jobId: string) {
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.abortController.abort();
      this.activeJobs.delete(jobId);
    }

    const job = getJob(jobId);
    if (job && (job.status === 'downloading' || job.status === 'queued')) {
      job.status = 'paused';
      job.speed = 0;
      job.eta = -1;
      job.updatedAt = Date.now();
      updateJob(job);
      saveResumeState(job);
      this.emit('job:status', { jobId, status: 'paused' });
    }

    this.processQueue();
  }

  public resumeJob(jobId: string) {
    const job = getJob(jobId);
    if (job && (job.status === 'paused' || job.status === 'failed')) {
      job.status = 'queued';
      job.speed = 0;
      job.eta = -1;
      job.error = undefined;
      job.updatedAt = Date.now();
      updateJob(job);
      saveResumeState(job);
      this.emit('job:status', { jobId, status: 'queued' });
    }

    this.processQueue();
  }

  public removeJob(jobId: string) {
    this.pauseJob(jobId);
    deleteJob(jobId);
    deleteResumeState(jobId);
    this.emit('job:removed', jobId);
  }

  public pauseAll() {
    const jobs = listJobs();
    for (const job of jobs) {
      if (job.status === 'downloading' || job.status === 'queued') {
        this.pauseJob(job.id);
      }
    }
  }

  public resumeAll() {
    const jobs = listJobs();
    for (const job of jobs) {
      if (job.status === 'paused' || job.status === 'failed') {
        this.resumeJob(job.id);
      }
    }
  }

  private processQueue() {
    const activeCount = this.activeJobs.size;
    const slotsAvailable = this.config.maxConcurrent - activeCount;
    if (slotsAvailable <= 0) return;

    const jobs = listJobs();
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
    updateJob(job);
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
        
        // Retry logic with exponential backoff
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
            break; // success
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

      // Check if aborted before merging
      if (abortController.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Merge files
      const finalDest = join(job.destination, job.filename);
      await mergeChunks(partPaths, finalDest, tmpDir);

      // Update state to completed
      job.status = 'completed';
      job.speed = 0;
      job.eta = 0;
      job.downloadedBytes = job.totalBytes;
      job.updatedAt = Date.now();
      
      updateJob(job);
      deleteResumeState(job.id);

      this.activeJobs.delete(job.id);
      this.emit('job:status', { jobId: job.id, status: 'completed' });
      
    } catch (err: any) {
      this.activeJobs.delete(job.id);

      if (abortController.signal.aborted || err.name === 'AbortError') {
        // Paused by user
        return;
      }

      // Failed download
      job.status = 'failed';
      job.speed = 0;
      job.eta = -1;
      job.error = err.message || 'Unknown download error';
      job.updatedAt = Date.now();
      
      // Update chunk status back to pending/failed
      for (const chunk of job.chunks) {
        if (chunk.status === 'downloading') {
          chunk.status = 'failed';
        }
      }

      updateJob(job);
      saveResumeState(job);

      this.emit('job:status', { jobId: job.id, status: 'failed', error: job.error });
    } finally {
      this.processQueue();
    }
  }
}
