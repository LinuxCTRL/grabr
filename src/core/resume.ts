import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DownloadJob } from './types';

const stateDir = join(homedir(), '.grabr');

function ensureStateDir() {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}

export function saveResumeState(job: DownloadJob): void {
  ensureStateDir();
  const filePath = join(stateDir, `${job.id}.json`);
  writeFileSync(filePath, JSON.stringify(job, null, 2), 'utf-8');
}

export function loadResumeState(jobId: string): DownloadJob | null {
  const filePath = join(stateDir, `${jobId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DownloadJob;
  } catch (err) {
    return null;
  }
}

export function deleteResumeState(jobId: string): void {
  const filePath = join(stateDir, `${jobId}.json`);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (err) {
      // Ignore
    }
  }
}
