# AGENT.md — Bun File Downloader

> **Project:** `grabr` — a modern, elegant file downloader built with Bun + TypeScript.
> **Interfaces:** CLI (terminal) + Web UI (local browser dashboard).
> **Stack:** Bun runtime, TypeScript, Hono (HTTP server), Ink (CLI UI), SQLite via `bun:sqlite`.

---

## What You're Building

`grabr` is a local-first download manager. You run it, point it at URLs, and it handles chunked parallel downloading, progress tracking, resumable transfers, and a clean dashboard — all from your machine. No cloud, no accounts.

---

## Project Structure

```
grabr/
├── src/
│   ├── core/                    # Pure download engine (no UI concerns)
│   │   ├── downloader.ts        # Main download orchestrator
│   │   ├── chunker.ts           # Splits file into ranges, manages chunks
│   │   ├── worker.ts            # Single chunk fetch worker
│   │   ├── merger.ts            # Assembles chunks into final file
│   │   ├── resume.ts            # Reads/writes .grabr resume files
│   │   └── types.ts             # Shared types: DownloadJob, Chunk, Status
│   │
│   ├── store/
│   │   ├── db.ts                # bun:sqlite setup, migrations
│   │   └── jobs.ts              # CRUD for download jobs
│   │
│   ├── cli/
│   │   ├── index.ts             # Entry point: parses args, routes commands
│   │   ├── commands/
│   │   │   ├── add.ts           # `grabr add <url>`
│   │   │   ├── list.ts          # `grabr list`
│   │   │   ├── pause.ts         # `grabr pause <id>`
│   │   │   ├── resume.ts        # `grabr resume <id>`
│   │   │   └── clear.ts         # `grabr clear`
│   │   └── ui/
│   │       ├── Dashboard.tsx    # Ink full-screen live dashboard
│   │       ├── JobRow.tsx       # Single job progress row
│   │       └── ProgressBar.tsx  # Inline progress bar component
│   │
│   ├── server/
│   │   ├── index.ts             # Hono app entry, starts HTTP + WebSocket
│   │   ├── routes/
│   │   │   ├── jobs.ts          # REST: GET/POST/DELETE /api/jobs
│   │   │   └── ws.ts            # WebSocket: streams progress events
│   │   └── static/              # Web UI (built separately or embedded)
│   │
│   └── web/                     # Web UI source
│       ├── index.html
│       ├── main.ts              # Vanilla TS, no framework overhead
│       ├── components/
│       │   ├── JobCard.ts
│       │   ├── ProgressRing.ts
│       │   └── Topbar.ts
│       └── styles/
│           └── main.css         # CSS custom properties, no framework
│
├── downloads/                   # Default output directory
├── .grabr/                      # State directory
│   └── grabr.db                 # SQLite database
├── package.json
├── tsconfig.json
├── bunfig.toml
└── AGENT.md                     # This file
```

---

## Core Concepts & Architecture

### 1. Download Engine (`src/core/`)

The engine is the heart of the project. It must be UI-agnostic — it emits events, and the CLI or Web UI listens.

```
URL → chunker → [chunk workers] → merger → final file
                      ↓
               EventEmitter / BunEventBus
                      ↓
           CLI Dashboard  |  WebSocket → Browser
```

**Key behaviors:**
- Check `Accept-Ranges` header → if supported, split into N chunks (default: 4)
- If no range support → single stream, still emit progress events
- Each chunk written to `downloads/.tmp/<jobId>/<chunkN>.part`
- On completion, `merger.ts` assembles in order → final file
- Resume: read `.grabr/<jobId>.json` to know which chunks completed

### 2. Job Model

```typescript
// src/core/types.ts

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed';

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

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  status: 'pending' | 'downloading' | 'done' | 'failed';
}
```

### 3. Store (`src/store/`)

Use `bun:sqlite` — no ORM, just typed queries. Fast, zero dependencies, ships with Bun.

```typescript
// src/store/db.ts
import { Database } from 'bun:sqlite';

const db = new Database('.grabr/grabr.db', { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    destination TEXT NOT NULL,
    total_bytes INTEGER DEFAULT 0,
    downloaded_bytes INTEGER DEFAULT 0,
    chunks TEXT DEFAULT '[]',   -- JSON
    status TEXT DEFAULT 'queued',
    speed INTEGER DEFAULT 0,
    eta INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    error TEXT
  )
`);

export { db };
```

### 4. CLI Interface (`src/cli/`)

Use **Ink** (React for terminals) for the live dashboard view. Use **citty** or a simple manual arg parser for command routing.

**Commands:**
```
grabr add <url> [--output ./downloads] [--chunks 4] [--name filename]
grabr list                        # Table of all jobs
grabr pause <id|all>
grabr resume <id|all>
grabr remove <id>
grabr clear --completed
grabr ui                          # Opens web dashboard in browser
grabr daemon                      # Runs server in background
```

**Dashboard mode** (`grabr add` enters live view automatically):
```
┌─ grabr ──────────────────────────────────────────────┐
│                                                      │
│  ubuntu-24.04.iso                         84%  ↓ 12 MB/s │
│  [████████████████████░░░░]  ETA 0:42             │
│                                                      │
│  node-v22-linux.tar.gz                    100%  ✓   │
│  [████████████████████████]  4.2 GB               │
│                                                      │
│  q quit  p pause  r resume  a add                   │
└──────────────────────────────────────────────────────┘
```

### 5. Web UI (`src/web/`)

**No framework.** Vanilla TypeScript + CSS custom properties. Keeps the bundle zero-dependency and instant.

**Design tokens:**
```css
:root {
  --bg:         #0e0e10;
  --surface:    #17171a;
  --border:     #2a2a2e;
  --text:       #e8e4d9;       /* warm cream */
  --muted:      #6b6b72;
  --accent:     #f59e0b;       /* amber */
  --success:    #22c55e;
  --error:      #ef4444;
  --radius:     8px;
  --font-mono:  'JetBrains Mono', monospace;
  --font-sans:  'DM Sans', sans-serif;
}
```

**Pages / views:**
- `Dashboard` — live job cards with progress rings, speed, ETA
- `Add modal` — URL input + options (chunks, output dir, filename)
- `Job detail` — per-chunk breakdown, full log, retry

**WebSocket events (server → browser):**
```typescript
// Progress update
{ type: 'job:progress', jobId, downloadedBytes, speed, eta }

// Status change
{ type: 'job:status', jobId, status }

// New job added
{ type: 'job:added', job: DownloadJob }

// Job removed
{ type: 'job:removed', jobId }
```

### 6. Server (`src/server/`)

Use **Hono** — tiny, fast, great TypeScript types, runs natively on Bun.

```typescript
// Endpoints
GET    /api/jobs              → list all jobs
POST   /api/jobs              → add job { url, options }
GET    /api/jobs/:id          → single job detail
POST   /api/jobs/:id/pause    → pause
POST   /api/jobs/:id/resume   → resume
DELETE /api/jobs/:id          → remove job
GET    /                      → serves Web UI
WS     /ws                    → real-time progress stream
```

---

## Phased Roadmap

### Phase 0 — Project Bootstrap (Day 1)
- [ ] `bun init` → TypeScript project
- [ ] Install: `hono`, `ink`, `nanoid`, `mime-types`, `@types/bun`
- [ ] Set up `tsconfig.json` with `"jsx": "react"` for Ink
- [ ] Configure `bunfig.toml`
- [ ] Create `.grabr/` directory, initialize SQLite schema
- [ ] Write `src/core/types.ts`

```bash
bun init -y
bun add hono ink nanoid mime-types
bun add -d @types/bun typescript
```

### Phase 1 — Core Download Engine (Days 2–4)
- [ ] `worker.ts`: fetch a single byte-range chunk, write to `.tmp/`, emit events
- [ ] `chunker.ts`: HEAD request → get Content-Length + Accept-Ranges → compute N ranges
- [ ] `downloader.ts`: orchestrate N workers in parallel, collect progress, call merger on done
- [ ] `merger.ts`: fs.open + sequential write of parts → final file, cleanup `.tmp/`
- [ ] `resume.ts`: write/read resume state per job
- [ ] Unit test with a known static file URL

### Phase 2 — Store + Job Queue (Day 5)
- [ ] `db.ts`: initialize SQLite, typed schema
- [ ] `jobs.ts`: `createJob`, `updateJob`, `getJob`, `listJobs`, `deleteJob`
- [ ] Wire downloader events → store updates
- [ ] Job queue: max N concurrent downloads (configurable, default: 3)

### Phase 3 — CLI (Days 6–7)
- [ ] `src/cli/index.ts`: arg parsing with Bun's `process.argv`
- [ ] Implement all commands: `add`, `list`, `pause`, `resume`, `remove`, `clear`
- [ ] `Dashboard.tsx` Ink component: live-updating job list, keyboard shortcuts
- [ ] `ProgressBar.tsx`: smooth animated progress
- [ ] `JobRow.tsx`: speed + ETA formatting
- [ ] Make `grabr add <url>` enter live dashboard automatically

### Phase 4 — HTTP Server + WebSocket (Day 8)
- [ ] Hono app with all REST routes
- [ ] WebSocket endpoint: on upgrade, add client to broadcast set
- [ ] Downloader events → broadcast to all WS clients
- [ ] Static file serving for Web UI

### Phase 5 — Web UI (Days 9–11)
- [ ] HTML shell + CSS with design tokens
- [ ] `main.ts`: WebSocket client, state store (plain object), render loop
- [ ] `JobCard.ts`: progress ring (SVG), speed badge, ETA, pause/resume buttons
- [ ] `Topbar.ts`: total speed, active count, add button
- [ ] Add modal: URL input + options
- [ ] Job detail panel: per-chunk grid visualization

### Phase 6 — Polish + DX (Days 12–14)
- [ ] `grabr daemon` → background process via `Bun.spawn`, PID file in `.grabr/`
- [ ] `grabr ui` → `Bun.openInBrowser('http://localhost:7474')`
- [ ] Config file: `~/.grabr/config.json` (default output dir, chunk count, max concurrent)
- [ ] Error handling: retry logic (3 attempts, exponential backoff)
- [ ] Filename collision resolution: `file(1).zip`, `file(2).zip`
- [ ] Speed smoothing: EMA (exponential moving average) over last 5 samples
- [ ] CLI help output: `grabr --help`

---

## Key Implementation Details

### Chunked Download Worker
```typescript
// src/core/worker.ts
export async function downloadChunk(
  url: string,
  chunk: ChunkInfo,
  destPath: string,
  onProgress: (bytes: number) => void
): Promise<void> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${chunk.start}-${chunk.end}` }
  });

  if (!response.ok || !response.body) throw new Error('Fetch failed');

  const file = Bun.file(destPath);
  const writer = file.writer();
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
    onProgress(value.byteLength);
  }

  await writer.end();
}
```

### Speed Calculation (EMA)
```typescript
// Exponential moving average for smooth speed display
class SpeedMeter {
  private ema = 0;
  private alpha = 0.2;  // smoothing factor
  private lastTime = Date.now();
  private lastBytes = 0;

  update(totalBytes: number) {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    const db = totalBytes - this.lastBytes;
    const instantSpeed = db / dt;
    this.ema = this.alpha * instantSpeed + (1 - this.alpha) * this.ema;
    this.lastTime = now;
    this.lastBytes = totalBytes;
    return this.ema;
  }

  get bytesPerSec() { return this.ema; }
}
```

### WebSocket Broadcast
```typescript
// src/server/ws.ts
const clients = new Set<ServerWebSocket>();

export function broadcast(event: object) {
  const msg = JSON.stringify(event);
  for (const client of clients) {
    client.send(msg);
  }
}
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `hono` | HTTP server + router + static serving |
| `ink` | React-based terminal UI |
| `nanoid` | Job ID generation |
| `mime-types` | Detect extension from Content-Type |
| `bun:sqlite` | Built-in — job persistence |

**No build step needed.** Bun runs TypeScript natively. For the Web UI, either write vanilla TS that Bun serves directly, or run `bun build src/web/main.ts --outdir src/server/static`.

---

## Config File (`~/.grabr/config.json`)
```json
{
  "outputDir": "~/Downloads",
  "maxConcurrent": 3,
  "defaultChunks": 4,
  "serverPort": 7474,
  "theme": "dark"
}
```

---

## Running the Project

```bash
# Install
bun install

# CLI: add and download
bun run src/cli/index.ts add https://example.com/file.zip

# Start the web server + daemon
bun run src/server/index.ts

# Open web UI
bun run src/cli/index.ts ui
```

---

## What to Build First

If you're starting today, build in this order:

1. **`types.ts`** — Define the shape of everything upfront. All other files depend on this.
2. **`worker.ts`** — The atom: download one chunk. Test with `curl`-equivalent.
3. **`chunker.ts` + `downloader.ts`** — Compose workers. Add progress events.
4. **`db.ts` + `jobs.ts`** — Persist state.
5. **`cli/commands/add.ts`** — First real user-facing thing. See it work.
6. **`Dashboard.tsx`** — Make it beautiful in the terminal.
7. **`server/`** — Expose everything over HTTP.
8. **`web/`** — The browser dashboard.

---

## Aesthetic Direction

### CLI
- Progress bars with Unicode block chars: `█▓░`
- Speed in human units: `12.4 MB/s`, `982 KB/s`
- Colors: amber for active, green for done, red for error, muted for queued
- Timestamps in relative format: `2m ago`, `in 45s`

### Web UI
- Dark background `#0e0e10`, warm cream text `#e8e4d9`
- Amber `#f59e0b` accent for active downloads and interactive elements
- Circular SVG progress rings, not flat bars — more elegant for a download card
- JetBrains Mono for file sizes, speeds, byte counts
- DM Sans for labels and UI chrome
- Micro-animation: progress ring stroke-dashoffset transition at 200ms ease

---

*This file is the source of truth. Update it as you make architectural decisions.*