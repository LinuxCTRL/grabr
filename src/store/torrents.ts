import { queryRun, queryGet, queryAll } from './db';
import type { TorrentJob, TorrentFileInfo } from '../core/types-torrent';

interface TorrentRow {
  job_id: string;
  input: string;
  info_hash: string;
  name: string;
  files: string;
  total_length: number;
  downloaded: number;
  status: string;
  seed_ratio: number;
  seed_time: number;
  created_at: number;
  updated_at: number;
  error: string | null;
}

function mapRowToTorrentJob(row: TorrentRow): TorrentJob {
  return {
    id: row.job_id,
    type: 'torrent',
    input: row.input,
    infoHash: row.info_hash,
    name: row.name,
    files: JSON.parse(row.files) as TorrentFileInfo[],
    totalLength: row.total_length,
    downloaded: row.downloaded,
    speed: 0,
    eta: -1,
    progress: row.total_length > 0 ? row.downloaded / row.total_length : 0,
    peers: 0,
    status: row.status as TorrentJob['status'],
    seedRatio: row.seed_ratio,
    seedTime: row.seed_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error || undefined,
  };
}

export async function createTorrentJob(job: TorrentJob): Promise<void> {
  await queryRun(
    `INSERT INTO torrents (job_id, input, info_hash, name, files, total_length, downloaded, status, seed_ratio, seed_time, created_at, updated_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.input,
      job.infoHash,
      job.name,
      JSON.stringify(job.files),
      job.totalLength,
      job.downloaded,
      job.status,
      job.seedRatio,
      job.seedTime,
      job.createdAt,
      job.updatedAt,
      job.error || null,
    ]
  );
}

export async function updateTorrentJob(job: Partial<TorrentJob> & { id: string }): Promise<void> {
  await queryRun(
    `UPDATE torrents
     SET input = ?, info_hash = ?, name = ?, files = ?, total_length = ?,
         downloaded = ?, status = ?, seed_ratio = ?, seed_time = ?,
         updated_at = ?, error = ?
     WHERE job_id = ?`,
    [
      job.input ?? '',
      job.infoHash ?? '',
      job.name ?? '',
      JSON.stringify(job.files ?? []),
      job.totalLength ?? 0,
      job.downloaded ?? 0,
      job.status ?? 'downloading',
      job.seedRatio ?? 0,
      job.seedTime ?? 0,
      Date.now(),
      job.error ?? null,
      job.id,
    ]
  );
}

export async function getTorrentJob(id: string): Promise<TorrentJob | null> {
  const row = await queryGet<TorrentRow>('SELECT * FROM torrents WHERE job_id = ?', [id]);
  return row ? mapRowToTorrentJob(row) : null;
}

export async function listTorrentJobs(): Promise<TorrentJob[]> {
  const rows = await queryAll<TorrentRow>('SELECT * FROM torrents ORDER BY created_at DESC');
  return rows.map(mapRowToTorrentJob);
}

export async function deleteTorrentJob(id: string): Promise<void> {
  await queryRun('DELETE FROM torrents WHERE job_id = ?', [id]);
}
