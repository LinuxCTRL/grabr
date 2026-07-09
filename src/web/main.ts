import type { DownloadJob } from '../core/types';
import type { TorrentJob } from '../core/types-torrent';
import { getJobCardHtml, getFileIcon } from './components/JobCard';
import { updateTopbar } from './components/Topbar';
import { formatBytes, formatSpeed, formatETA } from './utils';

type AnyJob = DownloadJob | TorrentJob;

function isTorrentJob(job: AnyJob): job is TorrentJob {
  return (job as TorrentJob).type === 'torrent';
}

function getJobFilename(job: AnyJob): string {
  return isTorrentJob(job) ? (job as TorrentJob).name : (job as DownloadJob).filename;
}

function getJobTotalBytes(job: AnyJob): number {
  return isTorrentJob(job) ? (job as TorrentJob).totalLength : (job as DownloadJob).totalBytes;
}

function getJobDownloadedBytes(job: AnyJob): number {
  return isTorrentJob(job) ? (job as TorrentJob).downloaded : (job as DownloadJob).downloadedBytes;
}

// Application State
let jobs: AnyJob[] = [];
let selectedJobId: string | null = null;
let ws: WebSocket | null = null;
let activeFilter = 'all';

// DOM Elements
const jobsGrid = document.getElementById('jobs-grid');
const addModalOverlay = document.getElementById('add-modal-overlay');
const btnOpenAdd = document.getElementById('btn-open-add');
const btnEmptyAdd = document.getElementById('btn-empty-add');
const btnCloseAdd = document.getElementById('btn-close-add');
const btnSubmitDownload = document.getElementById('btn-submit-download');
const btnClearCompleted = document.getElementById('btn-clear-completed');

const extensionModalOverlay = document.getElementById('extension-modal-overlay');
const btnGetExtension = document.getElementById('btn-get-extension');
const btnCloseExtension = document.getElementById('btn-close-extension');

const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailSubtitle = document.getElementById('detail-subtitle');
const chunkGrid = document.getElementById('chunk-grid');
const btnCloseDetail = document.getElementById('btn-close-detail');
const detailStatusVal = document.getElementById('detail-status-val');
const detailSpeedVal = document.getElementById('detail-speed-val');
const detailProgressVal = document.getElementById('detail-progress-val');
const detailEtaVal = document.getElementById('detail-eta-val');
const detailChunksTitle = document.getElementById('detail-chunks-title');

const detailFileName = document.getElementById('detail-file-name');
const detailFilePath = document.getElementById('detail-file-path');
const detailFileIcon = document.getElementById('detail-file-icon');

// Torrent detail elements
const detailTorrentInfo = document.getElementById('detail-torrent-info');
const detailInfoHash = document.getElementById('detail-info-hash');
const detailPeers = document.getElementById('detail-peers');
const detailSeedRatio = document.getElementById('detail-seed-ratio');
const detailTorrentFiles = document.getElementById('detail-torrent-files');

// Form Inputs
const inputUrl = document.getElementById('download-url') as HTMLInputElement;
const inputChunks = document.getElementById('download-chunks') as HTMLInputElement;
const inputName = document.getElementById('download-name') as HTMLInputElement;
const inputOutput = document.getElementById('download-output') as HTMLInputElement;
const ytQualityGroup = document.getElementById('yt-quality-group');
const downloadQuality = document.getElementById('download-quality') as HTMLSelectElement;

// Fetch job list via REST API
async function fetchJobs() {
  try {
    const res = await fetch('/api/jobs');
    const allJobs = res.ok ? await res.json() : [];
    jobs = allJobs as AnyJob[];
    renderJobsGrid();
    updateStats();
    renderDetailPanel();
  } catch (err) {
    console.error('Failed to fetch jobs:', err);
  }
}

// Connect to WebSocket progress feed
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    fetchJobs(); // fresh fetch on connect
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (err) {
      // Ignore parse errors
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected. Reconnecting in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Handle WebSocket updates
function handleWebSocketMessage(data: any) {
  if (data.type === 'job:progress') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      if (isTorrentJob(job)) {
        Object.assign(job, { downloaded: data.downloadedBytes, speed: data.speed, eta: data.eta, updatedAt: Date.now() });
      } else {
        Object.assign(job, { downloadedBytes: data.downloadedBytes, speed: data.speed, eta: data.eta, chunks: data.chunks, updatedAt: Date.now() });
      }
      return job;
    });
    updateJobCardDOM(data.jobId);
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === 'job:status') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      return Object.assign(job, { status: data.status, error: data.error, speed: 0, eta: -1, updatedAt: Date.now() });
    });
    refreshJobDetails(data.jobId);
  } else if (data.type === 'job:added') {
    if (!jobs.some((job) => job.id === data.job.id)) {
      jobs.unshift(data.job as AnyJob);
      renderJobsGrid();
      updateStats();
    }
  } else if (data.type === 'job:removed') {
    jobs = jobs.filter((job) => job.id !== data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      selectedJobId = null;
      renderDetailPanel();
    }
  } else if (data.type === 'jobs:cleared') {
    fetchJobs();
  } else if (data.type.startsWith('torrent:')) {
    handleTorrentWebSocketMessage(data);
  }
}

function handleTorrentWebSocketMessage(data: any) {
  if (data.type === 'torrent:progress') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      return Object.assign(job, {
        downloaded: data.downloaded,
        speed: data.speed,
        eta: data.eta,
        progress: data.progress,
        peers: data.peers,
        updatedAt: Date.now(),
      });
    });
    updateJobCardDOM(data.jobId);
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === 'torrent:done') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      return Object.assign(job, { status: 'seeding' as const, progress: 1, speed: 0, updatedAt: Date.now() });
    });
    updateJobCardDOM(data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === 'torrent:error') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      return Object.assign(job, { status: 'failed' as const, error: data.error, updatedAt: Date.now() });
    });
    refreshJobDetails(data.jobId);
  } else if (data.type === 'torrent:status') {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId) return job;
      return Object.assign(job, { status: data.status, updatedAt: Date.now() });
    });
    updateJobCardDOM(data.jobId);
    renderJobsGrid();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === 'torrent:removed') {
    jobs = jobs.filter((job) => job.id !== data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      selectedJobId = null;
      renderDetailPanel();
    }
  }
}

async function refreshJobDetails(jobId: string) {
  try {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    const endpoint = isTorrentJob(job) ? `/api/torrents/${jobId}` : `/api/jobs/${jobId}`;
    const res = await fetch(endpoint);
    if (res.ok) {
      const refreshedJob = await res.json();
      jobs = jobs.map((j) => (j.id === jobId ? { ...j, ...refreshedJob } : j));
      renderJobsGrid();
      updateStats();
      if (selectedJobId === jobId) {
        renderDetailPanel();
      }
    }
  } catch (err) {
    // Ignore detail load failures
  }
}

// Update DOM elements of a specific card directly for performance
function updateJobCardDOM(jobId: string) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || !jobsGrid) return;

  const card = jobsGrid.querySelector(`[data-id="${jobId}"]`) as HTMLElement;
  if (card) {
    const isSelected = selectedJobId === jobId;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = getJobCardHtml(job, isSelected);
    const newCard = tempDiv.firstElementChild as HTMLElement;
    if (newCard) {
      // Update properties on the existing node to keep hover states and transitions active
      card.className = newCard.className;
      card.innerHTML = newCard.innerHTML;
    }
  }
}

// Render the grid list of download jobs
function renderJobsGrid() {
  if (!jobsGrid) return;

  let filteredJobs = jobs;
  if (activeFilter === 'downloading') {
    filteredJobs = jobs.filter(j => j.status === 'downloading');
  } else if (activeFilter === 'completed') {
    filteredJobs = jobs.filter(j => j.status === 'completed');
  } else if (activeFilter === 'paused') {
    filteredJobs = jobs.filter(j => j.status === 'paused');
  }

  if (filteredJobs.length === 0) {
    jobsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">↓</div>
        <p>No ${activeFilter !== 'all' ? activeFilter : ''} downloads yet.</p>
        ${activeFilter === 'all' ? '<button id="btn-empty-add" class="btn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">Add one now</button>' : ''}
      </div>
    `;

    if (activeFilter === 'all') {
      const emptyBtn = document.getElementById('btn-empty-add');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', showAddModal);
      }
    }
    return;
  }

  const html = filteredJobs.map((job) => getJobCardHtml(job, selectedJobId === job.id)).join('');
  jobsGrid.innerHTML = html;
}

// Update top statistics bar
function updateStats() {
  const activeCount = jobs.filter((j) => j.status === 'downloading').length;
  const totalSpeed = jobs
    .filter((j) => j.status === 'downloading')
    .reduce((sum, j) => sum + j.speed, 0);

  updateTopbar(activeCount, totalSpeed);
}

function renderDetailPanel() {
  if (!detailPanel || !detailTitle || !detailSubtitle || !chunkGrid) return;

  if (!selectedJobId) {
    detailPanel.classList.remove('visible');
    return;
  }

  const job = jobs.find((j) => j.id === selectedJobId);
  if (!job) {
    detailPanel.classList.remove('visible');
    selectedJobId = null;
    return;
  }

  const isTorrent = isTorrentJob(job);
  const filename = getJobFilename(job);
  const totalBytes = getJobTotalBytes(job);
  const downloadedBytes = getJobDownloadedBytes(job);

  detailTitle.textContent = isTorrent ? 'Torrent Details' : 'Download Details';
  detailSubtitle.textContent = isTorrent ? 'Torrent job information' : 'Job configuration';

  if (detailFileName) {
    detailFileName.textContent = filename;
    detailFileName.setAttribute('title', filename);
  }
  if (detailFilePath) {
    const dest = isTorrent ? '' : (job as DownloadJob).destination;
    detailFilePath.textContent = dest;
    detailFilePath.setAttribute('title', dest);
  }
  if (detailFileIcon) {
    detailFileIcon.textContent = isTorrent ? '🧲' : getFileIcon(filename);
  }

  // Populate detailed summary stats fields
  if (detailStatusVal) {
    detailStatusVal.textContent = job.status.toUpperCase();
    detailStatusVal.style.color = job.status === 'downloading' ? 'var(--accent)' :
                                  job.status === 'completed' ? 'var(--success)' :
                                  job.status === 'failed' ? 'var(--error)' :
                                  job.status === 'seeding' ? '#22c55e' : 'var(--muted)';
  }
  if (detailSpeedVal) {
    detailSpeedVal.textContent = job.status === 'downloading' ? formatSpeed(job.speed) : '--';
  }
  if (detailProgressVal) {
    detailProgressVal.textContent = `${formatBytes(downloadedBytes)} of ${totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'}`;
  }
  if (detailEtaVal) {
    detailEtaVal.textContent = job.status === 'downloading' ? formatETA(job.eta) : '--';
  }

  // Render torrent-specific info or HTTP chunks
  if (isTorrent && detailTorrentInfo) {
    const t = job as TorrentJob;
    detailChunksTitle!.textContent = 'Torrent Files';

    if (detailInfoHash) detailInfoHash.textContent = t.infoHash;
    if (detailPeers) detailPeers.textContent = String(t.peers ?? 0);
    if (detailSeedRatio) detailSeedRatio.textContent = String(t.seedRatio ?? 0);

    detailTorrentInfo.style.display = 'block';

    // Show torrent files list
    if (detailTorrentFiles && t.files) {
      detailTorrentFiles.innerHTML = t.files.map((f, i) => `
        <div class="torrent-file-row" data-idx="${i}" data-selected="${f.selected}" title="${f.path}">
          <span class="torrent-file-idx">#${i}</span>
          <span class="torrent-file-path">${f.path}</span>
          <span class="torrent-file-size">${formatBytes(f.length)}</span>
          <span class="torrent-file-status ${f.selected ? 'selected' : 'deselected'}">${f.selected ? '✓' : '✗'}</span>
        </div>
      `).join('');
    }

    // Hide chunks grid for torrents
    chunkGrid.innerHTML = '';
  } else {
    if (detailTorrentInfo) detailTorrentInfo.style.display = 'none';

    let chunkHtml = '';
    const d = job as DownloadJob;
    if (d.chunks && d.chunks.length > 0) {
      if (detailChunksTitle) {
        detailChunksTitle.textContent = `Parallel Chunks (${d.chunks.length} Threads)`;
      }
      chunkHtml = d.chunks
        .map((chunk) => {
          const chunkSize = chunk.end - chunk.start + 1;
          const percent = chunkSize > 0 ? (chunk.downloaded / chunkSize) * 100 : 0;
          const tooltip = `Chunk #${chunk.index + 1}: ${Math.round(percent)}% (${formatBytes(chunk.downloaded)} / ${formatBytes(chunkSize)})`;

          return `
            <div class="chunk-block ${chunk.status}" data-chunk-index="${chunk.index}" data-tooltip="${tooltip}"></div>
          `;
        })
        .join('');
    } else {
      if (detailChunksTitle) {
        detailChunksTitle.textContent = 'Parallel Chunks';
      }
      chunkHtml = `<div style="grid-column: 1/-1; color: var(--muted); text-align: center; font-size: 0.8rem;">Single chunk stream</div>`;
    }

    chunkGrid.innerHTML = chunkHtml;
  }

  // Wire torrent file row click events for selection toggle
  const torrentFilesContainer = document.getElementById('detail-torrent-files');
  if (torrentFilesContainer) {
    torrentFilesContainer.onclick = async (e) => {
      const row = (e.target as HTMLElement).closest('.torrent-file-row') as HTMLElement;
      if (!row) return;
      const idx = parseInt(row.getAttribute('data-idx') || '', 10);
      if (isNaN(idx)) return;
      const isSelected = row.getAttribute('data-selected') === 'true';
      try {
        await fetch(`/api/torrents/${selectedJobId}/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indices: [idx], selected: !isSelected }),
        });
      } catch {
        // Ignore
      }
    };
  }

  detailPanel.classList.add('visible');
}

// API command invocations
async function pauseJob(id: string) {
  try {
    await fetch(`/api/jobs/${id}/pause`, { method: 'POST' });
  } catch (err) {
    console.error('Error pausing job:', err);
  }
}

async function resumeJob(id: string) {
  try {
    await fetch(`/api/jobs/${id}/resume`, { method: 'POST' });
  } catch (err) {
    console.error('Error resuming job:', err);
  }
}

async function removeJob(id: string) {
  if (confirm('Are you sure you want to remove this download job?')) {
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Error removing job:', err);
    }
  }
}

async function clearCompleted() {
  try {
    await fetch('/api/jobs/clear-completed', { method: 'POST' });
  } catch (err) {
    console.error('Error clearing jobs:', err);
  }
}

// Modal Toggle Helpers
function showAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.add('visible');
    hideTorrentFileSelection();
    // Reset to URL tab
    modalTabs.forEach((t) => t.classList.remove('active'));
    const urlTab = document.querySelector('.modal-tab[data-tab="url"]');
    if (urlTab) urlTab.classList.add('active');
    if (tabUrl) tabUrl.style.display = 'flex';
    if (tabTorrent) tabTorrent.style.display = 'none';
    if (tabUrlActions) tabUrlActions.style.display = 'flex';
    if (tabTorrentActions) tabTorrentActions.style.display = 'none';
    inputUrl.focus();
  }
}

function hideAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.remove('visible');
    hideTorrentFileSelection();
    // Clear inputs
    inputUrl.value = '';
    inputName.value = '';
    inputOutput.value = '';
    inputChunks.value = '4';
    if (torrentUrlInput) torrentUrlInput.value = '';
    if (ytQualityGroup) {
      ytQualityGroup.style.display = 'none';
    }
  }
}

// --- Torrent file selection state ---
let addedTorrentJob: any = null;

// Tab switching
const modalTabs = document.querySelectorAll('.modal-tab');
const tabUrl = document.getElementById('tab-url');
const tabTorrent = document.getElementById('tab-torrent');
const tabUrlActions = document.getElementById('tab-url-actions');
const tabTorrentActions = document.getElementById('tab-torrent-actions');
const torrentUrlInput = document.getElementById('torrent-url') as HTMLInputElement;
const btnAddTorrent = document.getElementById('btn-add-torrent-url') as HTMLButtonElement | null;
const torrentFilesSection = document.getElementById('torrent-files-section');
const torrentFileListModal = document.getElementById('torrent-file-list-modal');
const selectAllFiles = document.getElementById('select-all-files') as HTMLInputElement;
const btnCancelTorrent = document.getElementById('btn-cancel-torrent');
const btnStartTorrent = document.getElementById('btn-start-torrent');
const btnCloseAdd2 = document.getElementById('btn-close-add-2');

modalTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    modalTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.getAttribute('data-tab');
    if (t === 'url') {
      if (tabUrl) tabUrl.style.display = 'flex';
      if (tabTorrent) tabTorrent.style.display = 'none';
      if (tabUrlActions) tabUrlActions.style.display = 'flex';
      if (tabTorrentActions) tabTorrentActions.style.display = 'none';
    } else {
      if (tabUrl) tabUrl.style.display = 'none';
      if (tabTorrent) tabTorrent.style.display = 'flex';
      if (tabUrlActions) tabUrlActions.style.display = 'none';
      if (tabTorrentActions) tabTorrentActions.style.display = 'flex';
    }
    // Reset torrent file section when switching tabs
    hideTorrentFileSelection();
  });
});

function showTorrentFileSelection(job: any) {
  addedTorrentJob = job;
  if (torrentFilesSection) torrentFilesSection.style.display = 'block';
  if (torrentUrlInput) torrentUrlInput.style.display = 'none';
  if (btnAddTorrent) btnAddTorrent.style.display = 'none';
  if (torrentFileListModal && job.files) {
    torrentFileListModal.innerHTML = job.files.map((f: any, i: number) => `
      <label class="torrent-file-row-modal" data-idx="${i}">
        <input type="checkbox" class="file-checkbox" data-idx="${i}" ${f.selected ? 'checked' : ''}>
        <span class="file-path">${f.path}</span>
        <span class="file-size">${formatBytes(f.length)}</span>
      </label>
    `).join('');
  }
  if (selectAllFiles) selectAllFiles.checked = true;
}

function hideTorrentFileSelection() {
  addedTorrentJob = null;
  if (torrentFilesSection) torrentFilesSection.style.display = 'none';
  if (torrentUrlInput) torrentUrlInput.style.display = '';
  if (btnAddTorrent) btnAddTorrent.style.display = '';
  if (torrentFileListModal) torrentFileListModal.innerHTML = '';
  // Clear file upload
  torrentFileDataUrl = null;
  if (torrentFileName) {
    torrentFileName.textContent = '';
    torrentFileName.style.display = 'none';
  }
  if (torrentDropZone) {
    const content = torrentDropZone.querySelector('.torrent-drop-content') as HTMLElement;
    if (content) content.style.display = '';
  }
  if (torrentFileInput) torrentFileInput.value = '';
}

// Select-all toggle
if (selectAllFiles) {
  selectAllFiles.addEventListener('change', () => {
    const checkboxes = document.querySelectorAll('.file-checkbox') as NodeListOf<HTMLInputElement>;
    checkboxes.forEach((cb) => { cb.checked = selectAllFiles.checked; });
  });
}

// Delegate checkbox clicks in file list to update select-all state
if (torrentFileListModal) {
  torrentFileListModal.addEventListener('change', () => {
    const checkboxes = document.querySelectorAll('.file-checkbox') as NodeListOf<HTMLInputElement>;
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    if (selectAllFiles) selectAllFiles.checked = allChecked;
  });
}

// --- File upload for torrent tab ---
const torrentFileInput = document.getElementById('torrent-file-input') as HTMLInputElement;
const torrentDropZone = document.getElementById('torrent-drop-zone');
const torrentFileName = document.getElementById('torrent-file-name');
let torrentFileDataUrl: string | null = null;

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function handleTorrentFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.torrent') && file.type !== 'application/x-bittorrent') {
    alert('Please select a valid .torrent file.');
    return;
  }
  readFileAsDataURL(file).then((dataUrl) => {
    torrentFileDataUrl = dataUrl;
    if (torrentFileName) {
      torrentFileName.textContent = `📄 ${file.name} (${formatBytes(file.size)})`;
      torrentFileName.style.display = 'block';
    }
    if (torrentDropZone) {
      const content = torrentDropZone.querySelector('.torrent-drop-content') as HTMLElement;
      if (content) content.style.display = 'none';
    }
  }).catch((err) => {
    alert(`Failed to read file: ${err.message}`);
  });
}

if (torrentFileInput) {
  torrentFileInput.addEventListener('change', () => {
    const file = torrentFileInput.files?.[0];
    if (file) handleTorrentFile(file);
  });
}

if (torrentDropZone) {
  torrentDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    torrentDropZone.classList.add('drag-over');
  });
  torrentDropZone.addEventListener('dragleave', () => {
    torrentDropZone.classList.remove('drag-over');
  });
  torrentDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    torrentDropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleTorrentFile(file);
  });
}

// Adding torrent via the Add Torrent button
if (btnAddTorrent) {
  btnAddTorrent.addEventListener('click', async () => {
    const textUrl = (torrentUrlInput?.value || '').trim();
    const url = torrentFileDataUrl || textUrl;
    if (!url) {
      alert('Please enter a magnet link, torrent URL, or select a .torrent file.');
      return;
    }

    if (btnAddTorrent) {
      btnAddTorrent.textContent = 'Loading...';
      btnAddTorrent.disabled = true;
    }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (res.ok) {
        const job = await res.json();
        if (job.files && job.files.length > 0) {
          showTorrentFileSelection(job);
        } else {
          hideAddModal();
        }
      } else {
        const errText = await res.text();
        alert(`Failed to add torrent: ${errText}`);
      }
    } catch (err: any) {
      alert(`Network error adding torrent: ${err.message}`);
    } finally {
      if (btnAddTorrent) {
        btnAddTorrent.textContent = 'Add Torrent';
        btnAddTorrent.disabled = false;
      }
    }
  });
}

// Apply torrent file selection and start download
if (btnStartTorrent) {
  btnStartTorrent.addEventListener('click', async () => {
    if (!addedTorrentJob) return;

    const jobId = addedTorrentJob.id;
    const checkboxes = document.querySelectorAll('.file-checkbox') as NodeListOf<HTMLInputElement>;
    const selectedIndices: number[] = [];
    const deselectedIndices: number[] = [];

    checkboxes.forEach((cb) => {
      const idx = parseInt(cb.getAttribute('data-idx') || '', 10);
      if (!isNaN(idx)) {
        if (cb.checked) selectedIndices.push(idx);
        else deselectedIndices.push(idx);
      }
    });

    // Deselect files the user unchecked
    if (deselectedIndices.length > 0) {
      try {
        await fetch(`/api/torrents/${jobId}/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indices: deselectedIndices, selected: false }),
        });
      } catch {
        // Ignore
      }
    }

    hideAddModal();
  });
}

// Cancel in torrent mode
if (btnCancelTorrent) {
  btnCancelTorrent.addEventListener('click', () => {
    // Remove the added torrent
    if (addedTorrentJob) {
      fetch(`/api/jobs/${addedTorrentJob.id}`, { method: 'DELETE' }).catch(() => {});
    }
    hideTorrentFileSelection();
  });
}

function showExtensionModal() {
  if (extensionModalOverlay) {
    extensionModalOverlay.classList.add('visible');
  }
}

function hideExtensionModal() {
  if (extensionModalOverlay) {
    extensionModalOverlay.classList.remove('visible');
  }
}

// Wire Event Listeners
if (btnOpenAdd) btnOpenAdd.addEventListener('click', showAddModal);
if (btnCloseAdd) btnCloseAdd.addEventListener('click', hideAddModal);
if (btnCloseAdd2) btnCloseAdd2.addEventListener('click', hideAddModal);
// Close modal on overlay click
if (addModalOverlay) {
  addModalOverlay.addEventListener('click', (e) => {
    if (e.target === addModalOverlay) hideAddModal();
  });
}
if (btnGetExtension) btnGetExtension.addEventListener('click', showExtensionModal);
if (btnCloseExtension) btnCloseExtension.addEventListener('click', hideExtensionModal);
if (btnCloseDetail) {
  btnCloseDetail.addEventListener('click', () => {
    selectedJobId = null;
    renderDetailPanel();
    // remove highlight border on all cards
    document.querySelectorAll('.job-card').forEach((card) => {
      card.classList.remove('active');
    });
  });
}

if (btnClearCompleted) btnClearCompleted.addEventListener('click', clearCompleted);

// Handle job card clicks and action button clicks
if (jobsGrid) {
  jobsGrid.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const actionBtn = target.closest('.action-btn') as HTMLElement;

    if (actionBtn) {
      // Button action
      const action = actionBtn.getAttribute('data-action');
      const id = actionBtn.getAttribute('data-id');
      if (!id || !action) return;

      if (action === 'pause') {
        pauseJob(id);
      } else if (action === 'resume') {
        resumeJob(id);
      } else if (action === 'remove') {
        removeJob(id);
      }
    } else {
      // Card selection click
      const card = target.closest('.job-card') as HTMLElement;
      if (card) {
        const id = card.getAttribute('data-id');
        if (id) {
          selectedJobId = id;
          // highlight current active card
          document.querySelectorAll('.job-card').forEach((el) => {
            if (el.getAttribute('data-id') === id) {
              el.classList.add('active');
            } else {
              el.classList.remove('active');
            }
          });
          renderDetailPanel();
        }
      }
    }
  });
}

// URL auto-detect for YouTube quality selector
if (inputUrl && ytQualityGroup) {
  inputUrl.addEventListener('input', () => {
    const val = inputUrl.value.trim();
    if (val.includes('youtube.com') || val.includes('youtu.be')) {
      ytQualityGroup.style.display = 'block';
    } else {
      ytQualityGroup.style.display = 'none';
    }
  });
}

// Submit new download via modal
if (btnSubmitDownload) {
  btnSubmitDownload.addEventListener('click', async () => {
    let url = inputUrl.value.trim();
    if (!url) {
      alert('Please enter a valid URL or magnet link.');
      return;
    }

    // Append format as hash configuration if it is a YouTube URL
    if (ytQualityGroup && ytQualityGroup.style.display === 'block' && downloadQuality) {
      const selectedFormat = downloadQuality.value;
      url = `${url}#format=${encodeURIComponent(selectedFormat)}`;
    }

    const chunks = parseInt(inputChunks.value, 10) || 4;
    const name = inputName.value.trim() || undefined;
    const outputDir = inputOutput.value.trim() || undefined;

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          options: {
            chunks,
            filename: name,
            outputDir,
          },
        }),
      });

      if (res.ok) {
        hideAddModal();
      } else {
        const errText = await res.text();
        alert(`Failed to add job: ${errText}`);
      }
    } catch (err: any) {
      alert(`Network error adding job: ${err.message}`);
    }
  });
}

// Theme Toggle Logic
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeToggleIcon = document.getElementById('theme-toggle-icon');

function initTheme() {
  const savedTheme = localStorage.getItem('grabr-theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    if (themeToggleIcon) themeToggleIcon.textContent = '🌙';
  } else {
    document.body.classList.remove('light-theme');
    if (themeToggleIcon) themeToggleIcon.textContent = '☀️';
  }
}

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('grabr-theme', isLight ? 'light' : 'dark');
    if (themeToggleIcon) {
      themeToggleIcon.textContent = isLight ? '🌙' : '☀️';
    }
  });
}

async function checkUpdates() {
  const banner = document.getElementById('update-banner');
  const versionsSpan = document.getElementById('update-versions');
  const closeBtn = document.getElementById('btn-close-update');
  if (!banner || !versionsSpan) return;

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    });
  }

  try {
    const currentRes = await fetch('/api/version');
    if (!currentRes.ok) return;
    const currentData = await currentRes.json();
    const currentVer = currentData.version;

    const latestRes = await fetch('https://registry.npmjs.org/@linuxctrl/grabr/latest');
    if (!latestRes.ok) return;
    const latestData = await latestRes.json();
    const latestVer = latestData.version;

    const isNewer = (curr: string, lat: string) => {
      const c = curr.split('.').map(Number);
      const l = lat.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const cVal = c[i] ?? 0;
        const lVal = l[i] ?? 0;
        if (lVal > cVal) return true;
        if (lVal < cVal) return false;
      }
      return false;
    };

    if (isNewer(currentVer, latestVer)) {
      versionsSpan.textContent = `v${latestVer} (installed: v${currentVer})`;
      banner.style.display = 'flex';
    }
  } catch (err) {
    // Ignore version check errors
  }
}

// Bind Navigation Filters
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
    item.classList.add('active');
    activeFilter = item.getAttribute('data-filter') || 'all';
    renderJobsGrid();
  });
});

// Initialize Page
initTheme();
connectWebSocket();
checkUpdates();
