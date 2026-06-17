import { db } from './db';
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

export function createJob(job: DownloadJob): void {
  const query = db.prepare(`
    INSERT INTO jobs (id, url, filename, destination, total_bytes, downloaded_bytes, chunks, status, speed, eta, created_at, updated_at, error)
    VALUES ($id, $url, $filename, $destination, $total_bytes, $downloaded_bytes, $chunks, $status, $speed, $eta, $created_at, $updated_at, $error)
  `);

  query.run({
    $id: job.id,
    $url: job.url,
    $filename: job.filename,
    $destination: job.destination,
    $total_bytes: job.totalBytes,
    $downloaded_bytes: job.downloadedBytes,
    $chunks: JSON.stringify(job.chunks),
    $status: job.status,
    $speed: job.speed,
    $eta: job.eta,
    $created_at: job.createdAt,
    $updated_at: job.updatedAt,
    $error: job.error || null,
  });
}

export function updateJob(job: DownloadJob): void {
  const query = db.prepare(`
    UPDATE jobs
    SET url = $url,
        filename = $filename,
        destination = $destination,
        total_bytes = $total_bytes,
        downloaded_bytes = $downloaded_bytes,
        chunks = $chunks,
        status = $status,
        speed = $speed,
        eta = $eta,
        updated_at = $updated_at,
        error = $error
    WHERE id = $id
  `);

  query.run({
    $id: job.id,
    $url: job.url,
    $filename: job.filename,
    $destination: job.destination,
    $total_bytes: job.totalBytes,
    $downloaded_bytes: job.downloadedBytes,
    $chunks: JSON.stringify(job.chunks),
    $status: job.status,
    $speed: job.speed,
    $eta: job.eta,
    $updated_at: Date.now(),
    $error: job.error || null,
  });
}

export function getJob(id: string): DownloadJob | null {
  const query = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const row = query.get(id) as JobRow | null;
  return row ? mapRowToJob(row) : null;
}

export function listJobs(): DownloadJob[] {
  const query = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
  const rows = query.all() as JobRow[];
  return rows.map(mapRowToJob);
}

export function deleteJob(id: string): void {
  const query = db.prepare('DELETE FROM jobs WHERE id = ?');
  query.run(id);
}

export function clearCompletedJobs(): void {
  const query = db.prepare("DELETE FROM jobs WHERE status = 'completed'");
  query.run();
}
