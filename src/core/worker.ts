import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChunkInfo } from './types';

export async function downloadChunk(
  url: string,
  chunk: ChunkInfo,
  destPath: string,
  onProgress: (bytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const start = chunk.start + chunk.downloaded;
  
  // If the chunk is already completed, mark it done and return
  if (chunk.end > 0 && start > chunk.end) {
    chunk.status = 'done';
    return;
  }

  // Ensure target directory exists
  mkdirSync(dirname(destPath), { recursive: true });

  const headers: Record<string, string> = {};
  if (chunk.end > 0) {
    headers['Range'] = `bytes=${start}-${chunk.end}`;
  }

  const response = await fetch(url, {
    headers,
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Fetch failed with status ${response.status} ${response.statusText}`);
  }

  const isPartial = response.status === 206;
  const writeFlag = isPartial && chunk.downloaded > 0 ? 'a' : 'w';

  if (!isPartial && chunk.downloaded > 0) {
    // Server didn't serve partial content, start over
    chunk.downloaded = 0;
  }

  const fileStream = createWriteStream(destPath, { flags: writeFlag });
  const reader = response.body.getReader();

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      const ok = fileStream.write(value);
      if (!ok) {
        await new Promise<void>((resolve) => fileStream.once('drain', resolve));
      }

      chunk.downloaded += value.byteLength;
      onProgress(value.byteLength);
    }
    chunk.status = 'done';
  } catch (err) {
    chunk.status = 'failed';
    throw err;
  } finally {
    await new Promise<void>((resolve) => fileStream.end(resolve));
    try {
      reader.releaseLock();
    } catch {
      // Ignore if already released
    }
  }
}
