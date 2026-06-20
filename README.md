# grabr

> A modern, elegant file downloader — CLI tool & Node.js/Bun library.

![CLI Dashboard](https://img.shields.io/badge/Bun-Node.js-blue)
[![npm version](https://img.shields.io/npm/v/@linuxctrl/grabr)](https://www.npmjs.com/package/@linuxctrl/grabr)
[![docs](https://img.shields.io/badge/docs-linuxctrl--docs.vercel.app-amber)](https://linuxctrl-docs.vercel.app/docs/grabr)

grabr is a local-first download manager with chunked parallel downloading, progress tracking, resumable transfers, and a clean terminal dashboard — all from your machine. No cloud, no accounts.

**Works with:** Node.js ≥18, Bun ≥1.0

---

## Install

```bash
npm install -g @linuxctrl/grabr          # CLI globally
npm install @linuxctrl/grabr             # or as a library
```

---

## CLI Usage

```bash
grabr --help

grabr add <url>                    # Start a download
grabr add <url> --output ./videos  # Custom output directory
grabr add <url> --chunks 8         # 8 parallel chunks
grabr add <url> --name file.zip    # Custom filename

grabr list                         # List all jobs
grabr pause <id|all>               # Pause active downloads
grabr resume <id|all>              # Resume paused/failed downloads
grabr remove <id>                  # Remove a job
grabr clear --completed            # Clear completed jobs

grabr ui                           # Open Web UI in browser
grabr daemon start                 # Run server in background
grabr daemon stop                  # Stop background server
grabr daemon status                # Check daemon status
```

Run `grabr` without arguments to open the interactive full-screen dashboard.

---

## Library API

```typescript
import { Downloader, SpeedMeter, loadConfig, saveConfig } from '@linuxctrl/grabr'
import type { DownloadJob, DownloadOptions, JobStatus, ChunkInfo, GrabrConfig } from '@linuxctrl/grabr'

const downloader = new Downloader()
await downloader.start()

// Add a download
const job = await downloader.addJob('https://example.com/file.zip', {
  outputDir: './downloads',
  chunks: 4,
  filename: 'myfile.zip',
})

// Listen for events
downloader.on('job:progress', ({ jobId, downloadedBytes, speed, eta }) => {
  console.log(`${jobId}: ${downloadedBytes} bytes at ${speed} B/s`)
})

downloader.on('job:status', ({ jobId, status }) => {
  console.log(`${jobId}: ${status}`)
})

// Control downloads
await downloader.pauseJob(job.id)
await downloader.resumeJob(job.id)
await downloader.removeJob(job.id)

await downloader.stop()
```

### Types

```typescript
interface DownloadJob {
  id: string
  url: string
  filename: string
  destination: string
  totalBytes: number
  downloadedBytes: number
  chunks: ChunkInfo[]
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'
  speed: number        // bytes/sec (EMA smoothed)
  eta: number          // seconds remaining
  createdAt: number
  updatedAt: number
  error?: string
}

interface ChunkInfo {
  index: number
  start: number
  end: number
  downloaded: number
  status: 'pending' | 'downloading' | 'done' | 'failed'
}
```

---

## Project Structure

```
grabr/
├── dist/                        # Built output (published to npm)
│   ├── index.js                 #   ESM library
│   ├── index.cjs                #   CJS library
│   ├── index.d.ts               #   TypeScript declarations
│   └── cli.js                   #   CLI executable
├── src/
│   ├── index.ts                 # Public library entry point
│   ├── core/                    # Download engine (UI-agnostic)
│   │   ├── downloader.ts        #   Orchestrator (EventEmitter)
│   │   ├── chunker.ts           #   HEAD request → split into ranges
│   │   ├── worker.ts            #   Single chunk fetch
│   │   ├── merger.ts            #   Assembles chunks into final file
│   │   ├── resume.ts            #   Resume state files
│   │   ├── config.ts            #   ~/.grabr/config.json
│   │   └── types.ts             #   Shared types
│   ├── store/
│   │   ├── db.ts                #   sql.js SQLite setup
│   │   └── jobs.ts              #   CRUD for download jobs
│   ├── cli/
│   │   ├── index.tsx            # CLI entry (Ink/React)
│   │   ├── commands/            #   add, list, pause, resume, remove, clear, ui, daemon
│   │   └── ui/                  #   Ink components (Dashboard, JobRow, ProgressBar)
│   ├── server/
│   │   ├── index.ts             # Hono HTTP + WebSocket server
│   │   └── static/              # Built Web UI assets
│   └── web/                     # Web UI source (vanilla TS)
│       ├── index.html
│       ├── main.ts
│       ├── components/
│       └── styles/
├── downloads/                   # Default output directory
├── .grabr/                      # State directory (db + resume files)
├── package.json
├── tsconfig.json
└── bun.lock
```

---

## Architecture

```
URL → chunker → [chunk workers] → merger → final file
                      ↓
               EventEmitter
                      ↓
        CLI Dashboard  |  WebSocket → Browser UI
```

### Download Engine

- Checks `Accept-Ranges` header → parallel chunk download or single stream
- Speed calculated with EMA (exponential moving average, α=0.2)
- Retry logic: 3 attempts with exponential backoff
- Filename collision: `file(1).zip`, `file(2).zip` ...

### Storage

Uses [sql.js](https://github.com/sql-js/sql.js/) — SQLite compiled to WebAssembly. Works on both Node.js and Bun without native compilation.

Resume state is also saved as JSON files in `.grabr/<jobId>.json` for crash recovery.

### Server + Web UI

The daemon server uses [Hono](https://hono.dev/) with Bun's native WebSocket support. The Web UI is vanilla TypeScript with SVG progress rings and CSS custom properties.

---

## Development

```bash
# Install
bun install

# Run CLI in dev mode
bun run cli --help
bun run src/cli/index.tsx add https://example.com/file.zip

# Run server
bun run src/server/index.ts

# TypeScript check
bun run typecheck

# Build for production
bun run build

# Build outputs:
#   dist/index.js   — ESM library
#   dist/index.cjs  — CJS library
#   dist/cli.js     — CLI executable
#   dist/*.d.ts     — TypeScript declarations
```

### Prerequisites

- **Bun** (recommended for development) — `curl -fsSL https://bun.sh/install | bash`
- **Node.js** 18+ (for production use)

---

## Config

Config file: `~/.grabr/config.json`

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

## Publishing

```bash
bun run build
npm publish
```

The `dist/` directory is published, containing the compiled CLI and library.

---

## License

MIT
