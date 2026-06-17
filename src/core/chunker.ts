import { basename } from 'node:path';
import mime from 'mime-types';
import type { ChunkInfo } from './types';

export interface FileMetadata {
  filename: string;
  totalBytes: number;
  acceptRanges: boolean;
  chunks: ChunkInfo[];
}

export async function getFileMetadata(
  url: string,
  preferredChunks = 4,
  preferredFilename?: string
): Promise<FileMetadata> {
  let response: Response | null = null;
  
  try {
    // Try HEAD request first
    response = await fetch(url, { method: 'HEAD' });
  } catch (err) {
    // Ignore and fallback to GET
  }

  // If HEAD fails, doesn't return headers we want, or isn't 2xx, fallback to GET (aborted early)
  if (!response || !response.ok || !response.headers.get('content-length')) {
    const controller = new AbortController();
    try {
      response = await fetch(url, { signal: controller.signal });
      // Abort the body retrieval immediately to save bandwidth
      controller.abort();
    } catch (err: any) {
      if (err.name !== 'AbortError' && !response) {
        throw new Error(`Failed to reach ${url}: ${err.message}`);
      }
    }
  }

  if (!response) {
    throw new Error(`Failed to fetch metadata for URL: ${url}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const acceptRangesHeader = response.headers.get('accept-ranges');
  const contentDisposition = response.headers.get('content-disposition');
  const contentType = response.headers.get('content-type');

  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  // Some servers send "bytes" for accept-ranges, check if ranges are supported
  const acceptRanges = (acceptRangesHeader === 'bytes' || response.status === 206) && totalBytes > 0;

  // Resolve filename
  let filename = preferredFilename || '';
  if (!filename && contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  if (!filename) {
    try {
      const parsedUrl = new URL(url);
      filename = basename(parsedUrl.pathname);
    } catch {
      // Ignore
    }
  }

  if (!filename || filename === '/' || filename === '') {
    filename = 'download';
  }

  // If there's no extension, try to determine from Content-Type
  if (!filename.includes('.') && contentType) {
    const ext = mime.extension(contentType);
    if (ext) {
      filename = `${filename}.${ext}`;
    }
  }

  // Create chunks
  const chunks: ChunkInfo[] = [];
  if (acceptRanges && totalBytes > 0) {
    const numChunks = Math.min(preferredChunks, totalBytes);
    const chunkSize = Math.floor(totalBytes / numChunks);
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = i === numChunks - 1 ? totalBytes - 1 : start + chunkSize - 1;
      chunks.push({
        index: i,
        start,
        end,
        downloaded: 0,
        status: 'pending',
      });
    }
  } else {
    // Single chunk for non-resumable / unknown size
    chunks.push({
      index: 0,
      start: 0,
      end: totalBytes > 0 ? totalBytes - 1 : 0,
      downloaded: 0,
      status: 'pending',
    });
  }

  return {
    filename,
    totalBytes,
    acceptRanges,
    chunks,
  };
}
