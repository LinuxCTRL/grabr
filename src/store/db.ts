import type { SqlJsStatic, Database as SqlJsDatabase } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const stateDir = join(homedir(), '.grabr');
mkdirSync(stateDir, { recursive: true });

const dbPath = join(stateDir, 'grabr.db');

let SQL: SqlJsStatic;
let db: SqlJsDatabase;
let initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const initSqlJs = (await import('sql.js')).default;
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        const dir = dirname(fileURLToPath(import.meta.url));
        const localWasm = resolve(dir, file);
        if (existsSync(localWasm)) return localWasm;
        
        const candidate1 = resolve(dir, '..', 'node_modules', 'sql.js', 'dist', file);
        if (existsSync(candidate1)) return candidate1;
        
        const candidate2 = resolve(dir, '..', '..', 'node_modules', 'sql.js', 'dist', file);
        if (existsSync(candidate2)) return candidate2;
        
        return candidate1;
      },
    });

    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA journal_mode = WAL');
    db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        filename TEXT NOT NULL,
        destination TEXT NOT NULL,
        total_bytes INTEGER DEFAULT 0,
        downloaded_bytes INTEGER DEFAULT 0,
        chunks TEXT DEFAULT '[]',
        status TEXT DEFAULT 'queued',
        speed INTEGER DEFAULT 0,
        eta INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT
      )
    `);

    // Migration: add type column to jobs if missing
    const cols = db.exec("PRAGMA table_info('jobs')");
    const hasType = cols[0]?.values?.some((row: any) => row[1] === 'type');
    if (!hasType) {
      db.run("ALTER TABLE jobs ADD COLUMN type TEXT DEFAULT 'http'");
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS torrents (
        job_id TEXT PRIMARY KEY,
        input TEXT NOT NULL,
        info_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '[]',
        total_length INTEGER DEFAULT 0,
        downloaded INTEGER DEFAULT 0,
        status TEXT DEFAULT 'downloading',
        seed_ratio REAL DEFAULT 0,
        seed_time INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT
      )
    `);

    persistDb();
  })();

  return initPromise;
}

function persistDb(): void {
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

export async function queryRun(sql: string, params?: (number | string | Uint8Array | null)[]): Promise<void> {
  await init();
  db.run(sql, params);
  persistDb();
}

export async function queryGet<T>(
  sql: string,
  params?: (number | string | Uint8Array | null)[]
): Promise<T | undefined> {
  await init();
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    return stmt.step() ? (stmt.getAsObject() as T) : undefined;
  } finally {
    stmt.free();
  }
}

export async function queryAll<T>(
  sql: string,
  params?: (number | string | Uint8Array | null)[]
): Promise<T[]> {
  await init();
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    return results;
  } finally {
    stmt.free();
  }
}