export interface TorrentFileInfo {
  path: string;
  length: number;
  downloaded: number;
  selected: boolean;
}

export interface TorrentMetadata {
  infoHash: string;
  name: string;
  files: TorrentFileInfo[];
  totalLength: number;
  magnetURI: string;
  pieceLength: number;
  pieces: number;
}

export interface TorrentJob {
  id: string;
  type: 'torrent';
  input: string; // magnet URI, .torrent URL, or file path
  infoHash: string;
  name: string;
  files: TorrentFileInfo[];
  totalLength: number;
  downloaded: number;
  speed: number;
  eta: number;
  progress: number;
  peers: number;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'seeding';
  seedRatio: number;
  seedTime: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}
