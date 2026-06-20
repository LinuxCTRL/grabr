import { queryRun, queryGet, queryAll } from './db';
import type { DownloadJob, JobStatus, ChunkInfo } from '../core/types';

interface JobRow {
  id: string;
  url: string;
  filename: string;
  destination: string;
  total_bytes: number;
  downloaded_bytes: number;
  chunks: string;
  status: string;
  speed: number;
  eta: number;
  created_at: number;
  updated_at: number;
  error: string | null;
}

function mapRowToJob(row: JobRow): DownloadJob {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    destination: row.destination,
    totalBytes: row.total_bytes,
    downloadedBytes: row.downloaded_bytes,
    chunks: JSON.parse(row.chunks) as ChunkInfo[],
    status: row.status as JobStatus,
    speed: row.speed,
    eta: row.eta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error || undefined,
  };
}

export async function createJob(job: DownloadJob): Promise<void> {
  await queryRun(
    `INSERT INTO jobs (id, url, filename, destination, total_bytes, downloaded_bytes, chunks, status, speed, eta, created_at, updated_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.url,
      job.filename,
      job.destination,
      job.totalBytes,
      job.downloadedBytes,
      JSON.stringify(job.chunks),
      job.status,
      job.speed,
      job.eta,
      job.createdAt,
      job.updatedAt,
      job.error || null,
    ]
  );
}

export async function updateJob(job: DownloadJob): Promise<void> {
  await queryRun(
    `UPDATE jobs
     SET url = ?, filename = ?, destination = ?, total_bytes = ?, downloaded_bytes = ?,
         chunks = ?, status = ?, speed = ?, eta = ?, updated_at = ?, error = ?
     WHERE id = ?`,
    [
      job.url,
      job.filename,
      job.destination,
      job.totalBytes,
      job.downloadedBytes,
      JSON.stringify(job.chunks),
      job.status,
      job.speed,
      job.eta,
      Date.now(),
      job.error || null,
      job.id,
    ]
  );
}

export async function getJob(id: string): Promise<DownloadJob | null> {
  const row = await queryGet<JobRow>('SELECT * FROM jobs WHERE id = ?', [id]);
  return row ? mapRowToJob(row) : null;
}

export async function listJobs(): Promise<DownloadJob[]> {
  const rows = await queryAll<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC');
  return rows.map(mapRowToJob);
}

export async function deleteJob(id: string): Promise<void> {
  await queryRun('DELETE FROM jobs WHERE id = ?', [id]);
}

export async function clearCompletedJobs(): Promise<void> {
  await queryRun("DELETE FROM jobs WHERE status = 'completed'");
}