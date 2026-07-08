import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { spawn } from 'node:child_process';
import { createBunWebSocket } from 'hono/bun';
import { serveStatic } from 'hono/bun';
import { Downloader } from '../core/downloader';
import { listJobs, getJob, clearCompletedJobs } from '../store/jobs';
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
  const jobs = await listJobs();
  return c.json(jobs);
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
app.use('/*', serveStatic({ root: join(__dirname, 'static') }));

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