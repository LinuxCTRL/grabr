import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { serveStatic } from 'hono/bun';
import { Downloader } from '../core/downloader';
import { listJobs, getJob, clearCompletedJobs } from '../store/jobs';
import { loadConfig } from '../core/config';
import { join } from 'node:path';

const config = loadConfig();
const port = config.serverPort;

const { upgradeWebSocket, websocket } = createBunWebSocket();
const app = new Hono();

// Initialize and start downloader
const downloader = new Downloader();
downloader.start();

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

// REST API routes
app.get('/api/jobs', (c) => {
  const jobs = listJobs();
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

app.get('/api/jobs/:id', (c) => {
  const id = c.req.param('id');
  const job = getJob(id);
  if (!job) {
    return c.text('Job not found', 404);
  }
  return c.json(job);
});

app.post('/api/jobs/:id/pause', (c) => {
  const id = c.req.param('id');
  downloader.pauseJob(id);
  return c.json({ success: true });
});

app.post('/api/jobs/:id/resume', (c) => {
  const id = c.req.param('id');
  downloader.resumeJob(id);
  return c.json({ success: true });
});

app.delete('/api/jobs/:id', (c) => {
  const id = c.req.param('id');
  downloader.removeJob(id);
  return c.json({ success: true });
});

app.post('/api/jobs/pause-all', (c) => {
  downloader.pauseAll();
  return c.json({ success: true });
});

app.post('/api/jobs/resume-all', (c) => {
  downloader.resumeAll();
  return c.json({ success: true });
});

app.post('/api/jobs/clear-completed', (c) => {
  clearCompletedJobs();
  // Broadcast an update so UIs reload their lists
  broadcast({ type: 'jobs:cleared' });
  return c.json({ success: true });
});

// Serve Web UI static files
app.use('/*', serveStatic({ root: './src/server/static' }));

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
