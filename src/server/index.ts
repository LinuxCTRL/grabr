import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { spawn } from 'node:child_process';
import { createBunWebSocket } from 'hono/bun';
import { serveStatic } from 'hono/bun';
import { Downloader } from '../core/downloader';
import { listJobs, getJob, clearCompletedJobs } from '../store/jobs';
import { listTorrentJobs, getTorrentJob } from '../store/torrents';
import { loadConfig } from '../core/config';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = loadConfig();
const port = config.serverPort;

const { upgradeWebSocket, websocket } = createBunWebSocket();
const app = new Hono();

app.use('/api/*', cors());

// Initialize and start downloader
const downloader = new Downloader();
await downloader.start();

// Keep track of active WebSocket connections
const wsClients = new Set<any>();

function broadcast(event: object) {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    try {
      client.send(msg);
    } catch {
      wsClients.delete(client);
    }
  }
}

// Forward Downloader events to connected WebSocket clients
downloader.on('job:added', (job) => {
  broadcast({ type: 'job:added', job });
});

downloader.on('job:progress', (data) => {
  broadcast({ type: 'job:progress', ...data });
});

downloader.on('job:status', (data) => {
  broadcast({ type: 'job:status', ...data });
});

downloader.on('job:removed', (jobId) => {
  broadcast({ type: 'job:removed', jobId });
});

// Forward torrent events to WebSocket clients
downloader.on('torrent:progress', (data) => {
  broadcast({ type: 'torrent:progress', ...data });
});

downloader.on('torrent:done', (data) => {
  broadcast({ type: 'torrent:done', ...data });
});

downloader.on('torrent:error', (data) => {
  broadcast({ type: 'torrent:error', ...data });
});

downloader.on('torrent:status', (data) => {
  broadcast({ type: 'torrent:status', ...data });
});

downloader.on('torrent:removed', (data) => {
  broadcast({ type: 'torrent:removed', ...data });
});

// WebSocket Endpoint
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(evt, ws) {
      wsClients.add(ws);
    },
    onClose(evt, ws) {
      wsClients.delete(ws);
    },
  }))
);

app.get('/api/version', async (c) => {
  const version = process.env.GRABR_VERSION;
  return c.json({ version: version || '1.0.11' });
});

app.get('/api/jobs', async (c) => {
  try {
    const [jobs, torrents] = await Promise.all([
      listJobs(),
      listTorrentJobs(),
    ]);
    return c.json([...jobs, ...torrents]);
  } catch (err: any) {
    console.error('GET /api/jobs error:', err);
    return c.text(err.message, 500);
  }
});

app.post('/api/jobs', async (c) => {
  try {
    const body = await c.req.json();
    const { url, options } = body;
    if (!url) {
      return c.text('URL is required', 400);
    }
    const job = await downloader.addJob(url, options);
    return c.json(job);
  } catch (err: any) {
    return c.text(err.message, 500);
  }
});

app.get('/api/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const job = await getJob(id);
  if (!job) {
    return c.text('Job not found', 404);
  }
  return c.json(job);
});

// Torrent-specific API routes (list is merged into GET /api/jobs)
app.get('/api/torrents/:id', async (c) => {
  const id = c.req.param('id');
  const job = await getTorrentJob(id);
  if (!job) {
    return c.text('Torrent not found', 404);
  }
  return c.json(job);
});

app.get('/api/torrents/:id/stream/:fileIndex', async (c) => {
  const id = c.req.param('id');
  const fileIndex = parseInt(c.req.param('fileIndex'), 10);
  if (isNaN(fileIndex)) return c.text('Invalid file index', 400);

  const rangeHeader = c.req.header('range');
  let range: { start?: number; end?: number } | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const startStr = match[1];
      const endStr = match[2];
      if (startStr) range = { start: parseInt(startStr, 10) };
      if (endStr) range = { ...range, end: parseInt(endStr, 10) };
    }
  }

  const stream = downloader.getTorrentFileStream(id, fileIndex, range);
  if (!stream) return c.text('File not found', 404);

  // Get file info for Content-Length/Type
  const job = await getTorrentJob(id);
  const fileInfo = job?.files?.[fileIndex];
  if (!fileInfo) return c.text('File info not found', 404);

  const ext = fileInfo.path.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
    avi: 'video/x-msvideo', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
    ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    pdf: 'application/pdf', zip: 'application/zip',
  };
  const contentType = mimeTypes[ext || ''] || 'application/octet-stream';

  if (range) {
    const start = range.start || 0;
    const end = range.end || fileInfo.length - 1;
    c.status(206);
    c.header('Content-Range', `bytes ${start}-${end}/${fileInfo.length}`);
    c.header('Content-Length', String(end - start + 1));
  } else {
    c.header('Content-Length', String(fileInfo.length));
  }

  c.header('Content-Type', contentType);
  c.header('Accept-Ranges', 'bytes');
  c.header('Cache-Control', 'no-cache');

  // @ts-ignore — Hono + Bun stream body
  return c.body(stream as any);
});

app.post('/api/torrents/:id/select', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { indices, selected } = body;
    if (!Array.isArray(indices)) {
      return c.text('indices array is required', 400);
    }
    await downloader.selectTorrentFiles(id, indices, selected !== false);
    return c.json({ success: true });
  } catch (err: any) {
    return c.text(err.message, 500);
  }
});

app.post('/api/jobs/:id/pause', async (c) => {
  const id = c.req.param('id');
  await downloader.pauseJob(id);
  return c.json({ success: true });
});

app.post('/api/jobs/:id/resume', async (c) => {
  const id = c.req.param('id');
  await downloader.resumeJob(id);
  return c.json({ success: true });
});

app.delete('/api/jobs/:id', async (c) => {
  const id = c.req.param('id');
  await downloader.removeJob(id);
  return c.json({ success: true });
});

app.post('/api/jobs/pause-all', async (c) => {
  await downloader.pauseAll();
  return c.json({ success: true });
});

app.post('/api/jobs/resume-all', async (c) => {
  await downloader.resumeAll();
  return c.json({ success: true });
});

app.post('/api/jobs/clear-completed', async (c) => {
  await clearCompletedJobs();
  // Broadcast an update so UIs reload their lists
  broadcast({ type: 'jobs:cleared' });
  return c.json({ success: true });
});

app.get('/api/youtube/formats', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.text('URL query parameter is required', 400);
  }
  return new Promise<any>((resolve) => {
    const child: any = spawn('yt-dlp', ['-j', '--no-playlist', url]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: any) => stdout += d.toString());
    child.stderr.on('data', (d: any) => stderr += d.toString());
    child.on('close', (code: any) => {
      if (code !== 0) {
        resolve(c.text(`yt-dlp failed: ${stderr}`, 500));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve(c.json(info));
      } catch (err) {
        resolve(c.text(`Failed to parse yt-dlp output: ${err}`, 500));
      }
    });
  });
});

// Serve Web UI static files
const staticDir = join(__dirname, 'static');
const indexHtml = await Bun.file(join(staticDir, 'index.html')).text();
app.get('/main.js', serveStatic({ root: staticDir }));
app.get('/main.css', serveStatic({ root: staticDir }));
app.get('/logo.png', serveStatic({ root: staticDir }));
app.get('/fonts/*', serveStatic({ root: staticDir }));
// Catch-all: serve index.html for unmatched GET routes
app.notFound((c) => {
  if (c.req.method === 'GET') {
    return c.html(indexHtml);
  }
  return c.text('Not Found', 404);
});

console.log(`Starting Grabr server on http://localhost:${port}`);

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port,
});

// Handle clean server shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  downloader.stop();
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  downloader.stop();
  server.stop();
  process.exit(0);
});