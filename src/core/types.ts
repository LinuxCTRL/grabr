export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed';

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  status: 'pending' | 'downloading' | 'done' | 'failed';
}

export interface DownloadJob {
  id: string;               // nanoid
  url: string;
  filename: string;
  destination: string;
  totalBytes: number;
  downloadedBytes: number;
  chunks: ChunkInfo[];
  status: JobStatus;
  speed: number;            // bytes/sec, rolling average
  eta: number;              // seconds remaining
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface DownloadOptions {
  outputDir?: string;
  filename?: string;
  chunks?: number;
}
