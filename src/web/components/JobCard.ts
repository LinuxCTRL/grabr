import type { DownloadJob } from '../../core/types';
import type { TorrentJob } from '../../core/types-torrent';
import { getProgressRingHtml } from './ProgressRing';
import { formatBytes, formatSpeed, formatETA } from '../utils';

type AnyJob = DownloadJob | TorrentJob;

export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return '⬇️';
  if (['zip', 'rar', 'tar', 'gz', '7z', 'dmg', 'pkg', 'iso'].includes(ext)) return '📦';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎥';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return '🎵';
  if (['exe', 'msi', 'sh', 'bat'].includes(ext)) return '⚙️';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return '📄';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
  return '⬇️';
}

function isTorrentJob(job: AnyJob): job is TorrentJob {
  return (job as TorrentJob).type === 'torrent';
}

export function getJobCardHtml(job: AnyJob, isSelected: boolean): string {
  const isTorrent = isTorrentJob(job);

  const totalBytes = isTorrent ? (job as TorrentJob).totalLength : (job as DownloadJob).totalBytes;
  const downloadedBytes = isTorrent ? (job as TorrentJob).downloaded : (job as DownloadJob).downloadedBytes;
  const filename = isTorrent ? (job as TorrentJob).name : (job as DownloadJob).filename;
  const status = job.status;

  const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
  const activeClass = isSelected ? 'active' : '';

  let speedText = '--';
  let etaText = '--';

  if (status === 'downloading') {
    speedText = isTorrent ? `${formatSpeed(job.speed)} | ${(job as TorrentJob).peers} peers` : formatSpeed(job.speed);
    etaText = formatETA(job.eta);
  } else if (status === 'completed') {
    speedText = 'Completed';
    etaText = 'Done';
  } else if (status === 'paused') {
    speedText = 'Paused';
    etaText = 'Resumable';
  } else if (status === 'queued') {
    speedText = 'Queued';
    etaText = 'Waiting...';
  } else if (status === 'failed') {
    speedText = 'Failed';
    etaText = 'Error';
  } else if (status === 'seeding') {
    speedText = 'Seeding';
    etaText = '₿';
  }

  let actionButton = '';
  if (status === 'downloading' || status === 'queued') {
    actionButton = `
      <button class="btn-action-icon action-btn" data-action="pause" data-id="${job.id}" title="Pause">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    `;
  } else if (status === 'paused' || status === 'failed' || status === 'seeding') {
    actionButton = `
      <button class="btn-action-icon action-btn" data-action="resume" data-id="${job.id}" title="Resume">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    `;
  }

  const deleteButton = `
    <button class="btn-action-icon btn-danger action-btn" data-action="remove" data-id="${job.id}" title="Delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  `;

  const icon = isTorrent ? '🧲' : getFileIcon(filename);
  const sizeText = `${formatBytes(downloadedBytes)} of ${totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'}`;

  const badge = isTorrent ? '<span class="torrent-badge">TORRENT</span>' : '';

  return `
    <div class="job-card ${activeClass}" data-id="${job.id}">
      <span style="font-size: 1.5rem; flex-shrink: 0; user-select: none;">${icon}</span>
      
      <div class="job-card-header">
        <span class="job-title" title="${filename}">${filename}${badge}</span>
        <span class="job-meta-desc">${sizeText} | ${status.toUpperCase()}</span>
      </div>

      <div class="progress-ring-container">
        ${getProgressRingHtml(percent, status)}
        <span class="progress-ring-text">${Math.round(percent)}%</span>
      </div>

      <div class="job-stats-compact">
        <span class="job-speed-compact">${speedText}</span>
        <span class="job-eta-compact">${etaText}</span>
      </div>

      <div class="job-actions-compact">
        ${actionButton}
        ${deleteButton}
      </div>
    </div>
  `;
}
