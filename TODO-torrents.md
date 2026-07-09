# Torrent Support — Implementation Plan

## Overview
Add BitTorrent support to grabr so `.torrent` files and `magnet:` links can be downloaded alongside regular HTTP/HTTPS downloads.

---

## Phase 1: Core Engine ✅

- [x] **Pick a torrent library** — Evaluated webtorrent (Node.js/Bun compatible, maintained, supports magnet + DHT + P2P)
- [x] **Add dependency** — `bun add webtorrent@3.0.16`
- [x] **Create `src/core/torrent-downloader.ts`** — Wraps WebTorrent:
  - `add(input: string | Buffer, outputDir?)` — accepts magnet link, .torrent, or buffer
  - Track progress via webtorrent events (download speed, peers, ETA)
  - Pause/resume (pause swarm, resume)
  - Remove (destroy swarm, cleanup job)
- [x] **Create `src/core/types-torrent.ts`** — Torrent-specific types:
  - `TorrentJob` with `infoHash`, `files`, `peers`, `seedRatio`, `seedTime`
  - `TorrentFileInfo` — `{ path, length, downloaded, selected }`
  - `TorrentMetadata` — `{ infoHash, name, files, trackers }`
- [x] **Integrate with job router** — In `downloader.ts`, `isTorrentInput()` routes `magnet:` and `.torrent` to `TorrentDownloader`
- [x] **File selection** — `TorrentDownloader.selectFiles()` method selects/deselects webtorrent files and persists to DB; `POST /api/torrents/:id/select` endpoint; `grabr torrent select/deselect <id> <idx...>` CLI; Web UI file rows are clickable to toggle selection; `restore()` applies saved file selection on startup

## Phase 2: Storage & Resume ✅

- [x] **Extend SQLite schema** — Added `torrents` table with `job_id`, `input`, `info_hash`, `name`, `files` (JSON), `total_length`, `downloaded`, `status`, `seed_ratio`, `seed_time`, timestamps, `error`
- [x] **Create `src/store/torrents.ts`** — CRUD for TorrentJob: `createTorrentJob`, `updateTorrentJob`, `getTorrentJob`, `listTorrentJobs`, `deleteTorrentJob`
- [x] **Persist on add** — `TorrentDownloader.add()` saves to DB via `createTorrentJob()`
- [x] **Persist on progress** — `TorrentDownloader.attachTorrentEvents()` updates DB on download/done/error events
- [x] **Persist on pause/resume/remove** — `updateTorrentJob`/`deleteTorrentJob` called in pause/resume/remove
- [x] **Startup resume** — `Downloader.start()` calls `resetInterruptedTorrents()` then `TorrentDownloader.loadPersistedJobs()` which re-adds downloading/paused torrents to webtorrent
- [x] **Migration** — Added `type` column to existing `jobs` table (ALTER TABLE ADD COLUMN)
- [x] **Tracker/DHT state** — webtorrent persists DHT routing table + tracker state in LevelDB at `~/.grabr/torrents/` (passed as `path` to constructor). Custom trackers from config (`trackers` list) can be passed via `announce` option on `client.add()`.

## Phase 3: CLI Integration ✅

- [x] **`grabr add magnet:?...`** — Works via `isTorrentInput()` routing in `downloader.addJob()`
- [x] **`grabr add file.torrent`** — Detects `.torrent` extension and passes to webtorrent (accepts file path, URL, or buffer)
- [x] **`grabr list`** — Shows both HTTP and torrent jobs; torrents display name, progress, peers, status
- [x] **`grabr torrent <action> <id>`** — New subcommand with:
  - `list` — List all torrent jobs with peers, progress, seed ratio
  - `files <id>` — List files inside a torrent
  - `info <id>` — Show detailed torrent metadata
  - `seed <id> <ratio>` — Set seed ratio target
- [x] **Daemon API** — Added `GET /api/torrents` and `GET /api/torrents/:id` endpoints; WebSocket torrent event forwarding
- [x] **Help text** — Updated with torrent command documentation

## Phase 4: Web UI + Dashboard ✅

- [x] **Web UI job cards** — Torrent jobs shown alongside HTTP jobs with 🧲 icon, `(torrent)` badge, peer count in speed display
- [x] **Web UI add modal** — Placeholder accepts magnet/torrent URLs; posted to `/api/jobs` which routes appropriately
- [x] **Detail panel** — Shows torrent-specific fields: info hash, peers, seed ratio, file list with sizes/selection status
- [x] **WebSocket events** — `torrent:progress`, `torrent:done`, `torrent:error`, `torrent:status`, `torrent:removed` all handled with real-time card updates
- [x] **Filter support** — Torrent jobs respect download/completed/paused filters in the sidebar
- [x] **Statuses** — `seeding` status displayed with green color; resume button allows re-download

## Phase 5: Configuration ✅

- [x] **Config options** — Added `TorrentConfig` interface to `GrabrConfig` with `downloadDir`, `maxPeers`, `seedRatio`, `seedTime`, `dhtEnabled`, `trackers`
- [x] **Config defaults** — Sensible defaults: downloadDir=~/.grabr/torrents, maxPeers=100, seedRatio=0, seedTime=0, dhtEnabled=true, trackers=[]
- [x] **Config CLI** — `grabr config list` shows all config; `grabr config set torrent.seedRatio 2.0` sets torrent-specific keys; type coercion for boolean/numbers
- [x] **Integration** — TorrentDownloader reads `config.torrent.dhtEnabled`/`maxPeers`/`downloadDir` when creating WebTorrent client; `seedRatio`/`seedTime` applied to new jobs

## Phase 6: Polish ✅

- [x] **Streaming playback** — `GET /api/torrents/:id/stream/:fileIndex` endpoint serves partially-downloaded torrent files with HTTP range request support (video seeking), proper MIME types, and `Accept-Ranges: bytes`
- [x] **Sequential download** — `config.torrent.sequentialDownload` (bool); when enabled, `file.select(true)` is called so pieces download in order for streaming; configurable via `grabr config set torrent.sequentialDownload true`
- [x] **Encryption** — MSE (Message Stream Encryption) is built into the BitTorrent protocol and handled transparently by webtorrent; no additional configuration needed
- [x] **Performance** — webtorrent uses LevelDB-based storage and streaming; memory usage scales with active piece buffers (configurable via `maxPeers`); sequential mode increases piece buffer priority for contiguous data

---

## Notes

- The HTTP `Downloader` and `TorrentDownloader` should share the same `EventEmitter` interface so the CLI/Web UI treat them uniformly.
- Torrents don't use chunking — pieces are managed by the BitTorrent protocol. The existing chunk visualiser should show pieces instead.
- `webtorrent` uses its own storage layer. It can stream to disk directly, but we need to hook into progress events to update our DB.
