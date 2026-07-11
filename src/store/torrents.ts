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
  const existing = await getTorrentJob(job.id);
  if (!existing) return;

  const input = job.input !== undefined ? job.input : existing.input;
  const infoHash = job.infoHash !== undefined ? job.infoHash : existing.infoHash;
  const name = job.name !== undefined ? job.name : existing.name;
  const files = job.files !== undefined ? job.files : existing.files;
  const totalLength = job.totalLength !== undefined ? job.totalLength : existing.totalLength;
  const downloaded = job.downloaded !== undefined ? job.downloaded : existing.downloaded;
  const status = job.status !== undefined ? job.status : existing.status;
  const seedRatio = job.seedRatio !== undefined ? job.seedRatio : existing.seedRatio;
  const seedTime = job.seedTime !== undefined ? job.seedTime : existing.seedTime;
  const error = job.error !== undefined ? job.error : existing.error;

  await queryRun(
    `UPDATE torrents
     SET input = ?, info_hash = ?, name = ?, files = ?, total_length = ?,
         downloaded = ?, status = ?, seed_ratio = ?, seed_time = ?,
         updated_at = ?, error = ?
     WHERE job_id = ?`,
    [
      input,
      infoHash,
      name,
      JSON.stringify(files),
      totalLength,
      downloaded,
      status,
      seedRatio,
      seedTime,
      Date.now(),
      error || null,
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
