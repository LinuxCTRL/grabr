import { createReadStream, createWriteStream, rmSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Merges chunk parts into the final destination file and cleans up the temporary files.
 * @param partPaths Array of absolute paths to the chunk part files in order
 * @param destPath Absolute path of the final output file
 * @param tmpDir Absolute path to the temporary directory of this job
 */
export async function mergeChunks(
  partPaths: string[],
  destPath: string,
  tmpDir: string
): Promise<void> {
  const targetDir = dirname(destPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const finalWriteStream = createWriteStream(destPath);

  try {
    for (const partPath of partPaths) {
      if (!existsSync(partPath)) {
        throw new Error(`Part file missing: ${partPath}`);
      }
      const partReadStream = createReadStream(partPath);
      // Pipe the chunk part file to the destination. We set { end: false } so
      // the destination stream isn't closed after the first part completes.
      await pipeline(partReadStream, finalWriteStream, { end: false });
    }
  } catch (err) {
    finalWriteStream.destroy();
    throw err;
  }

  // End the destination write stream and wait for it to finish
  await new Promise<void>((resolve, reject) => {
    finalWriteStream.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Clean up the temporary folder containing the chunk files
  if (existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}
