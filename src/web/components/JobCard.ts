import type { DownloadJob } from '../../core/types';
import { getProgressRingHtml } from './ProgressRing';
import { formatBytes, formatSpeed, formatETA } from '../utils';

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

export function getJobCardHtml(job: DownloadJob, isSelected: boolean): string {
  const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
  const activeClass = isSelected ? 'active' : '';

  let speedText = '--';
  let etaText = '--';
  
  if (job.status === 'downloading') {
    speedText = formatSpeed(job.speed);
    etaText = formatETA(job.eta);
  } else if (job.status === 'completed') {
    speedText = 'Completed';
    etaText = 'Done';
  } else if (job.status === 'paused') {
    speedText = 'Paused';
    etaText = 'Resumable';
  } else if (job.status === 'queued') {
    speedText = 'Queued';
    etaText = 'Waiting...';
  } else if (job.status === 'failed') {
    speedText = 'Failed';
    etaText = 'Error';
  }

  // Choose control buttons based on status
  let actionButton = '';
  if (job.status === 'downloading' || job.status === 'queued') {
    actionButton = `
      <button class="btn-action-icon action-btn" data-action="pause" data-id="${job.id}" title="Pause">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    `;
  } else if (job.status === 'paused' || job.status === 'failed') {
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

  const icon = getFileIcon(job.filename);
  const sizeText = `${formatBytes(job.downloadedBytes)} of ${job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'}`;

  return `
    <div class="job-card ${activeClass}" data-id="${job.id}">
      <span style="font-size: 1.5rem; flex-shrink: 0; user-select: none;">${icon}</span>
      
      <div class="job-card-header">
        <span class="job-title" title="${job.filename}">${job.filename}</span>
        <span class="job-meta-desc">${sizeText} | ${job.status.toUpperCase()}</span>
      </div>

      <div class="progress-ring-container">
        ${getProgressRingHtml(percent, job.status)}
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
