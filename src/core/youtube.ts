import { spawn } from 'node:child_process';

/**
 * Checks if a given URL is a YouTube link.
 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
  } catch {
    return false;
  }
}

interface YouTubeMeta {
  filename: string;
  totalBytes: number;
}

/**
 * Resolves YouTube video title and approximate size using yt-dlp.
 */
export async function getYouTubeMetadata(url: string): Promise<YouTubeMeta> {
  const cleanUrl = url.split('#')[0] || '';
  return new Promise((resolve, reject) => {
    const child: any = spawn('yt-dlp', ['-j', '--no-playlist', cleanUrl]);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: any) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: any) => {
      stderr += data.toString();
    });

    child.on('close', (code: any) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr.trim() || 'Unknown error'}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const title = info.title || 'youtube_video';
        const ext = info.ext || 'mp4';
        
        // Sanitize filename to remove dangerous characters for OS filesystem paths
        const filename = `${title}.${ext}`.replace(/[<>:"/\\|?*]/g, '_');
        
        const totalBytes = info.filesize || info.filesize_approx || 0;
        resolve({ filename, totalBytes });
      } catch (err) {
        reject(new Error(`Failed to parse yt-dlp output: ${err}`));
      }
    });
  });
}
