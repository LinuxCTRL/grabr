import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { join } from 'path';

// Ensure the state directory exists
const stateDir = join(process.cwd(), '.grabr');
mkdirSync(stateDir, { recursive: true });

const dbPath = join(stateDir, 'grabr.db');
const db = new Database(dbPath, { create: true });

// Enable WAL mode for performance
db.run('PRAGMA journal_mode = WAL;');

// Initialize database schema
db.run(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    destination TEXT NOT NULL,
    total_bytes INTEGER DEFAULT 0,
    downloaded_bytes INTEGER DEFAULT 0,
    chunks TEXT DEFAULT '[]',   -- JSON string
    status TEXT DEFAULT 'queued',
    speed INTEGER DEFAULT 0,
    eta INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    error TEXT
  )
`);

export { db };
