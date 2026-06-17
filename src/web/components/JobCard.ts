import type { DownloadJob } from '../../core/types';
import { getProgressRingHtml } from './ProgressRing';
import { formatBytes, formatSpeed, formatETA } from '../utils';

export function getJobCardHtml(job: DownloadJob, isSelected: boolean): string {
  const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
  const activeClass = isSelected ? 'active' : '';

  let speedText = '--';
  let etaText = '--';
  
  if (job.status === 'downloading') {
    speedText = formatSpeed(job.speed);
    etaText = `${formatETA(job.eta)} remaining`;
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
    etaText = 'Error occurred';
  }

  // Choose control buttons based on status
  let actionButton = '';
  if (job.status === 'downloading' || job.status === 'queued') {
    actionButton = `
      <button class="action-btn btn-pause" data-action="pause" data-id="${job.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      </button>
    `;
  } else if (job.status === 'paused' || job.status === 'failed') {
    actionButton = `
      <button class="action-btn btn-resume" data-action="resume" data-id="${job.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Resume
      </button>
    `;
  }

  return `
    <div class="job-card ${activeClass}" data-id="${job.id}">
      <div class="job-card-header">
        <div style="display: flex; flex-direction: column; gap: 0.5rem; flex-grow: 1; max-width: calc(100% - 60px);">
          <span class="job-title" title="${job.filename}">${job.filename}</span>
          <span class="job-status-badge badge-${job.status}">${job.status}</span>
        </div>
        
        <div class="progress-ring-container">
          ${getProgressRingHtml(percent, job.status)}
          <span class="progress-ring-text">${Math.round(percent)}%</span>
        </div>
      </div>

      <div class="job-stats">
        <div class="job-speed-eta">
          <span class="job-speed">${speedText}</span>
          <span>${etaText}</span>
        </div>
        
        <div class="job-size">
          <span style="color: var(--text); font-weight: 600;">
            ${formatBytes(job.downloadedBytes)}
          </span>
          <span>of ${job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'}</span>
        </div>
      </div>

      <div class="job-actions">
        ${actionButton}
        <button class="action-btn btn-remove" data-action="remove" data-id="${job.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `;
}
