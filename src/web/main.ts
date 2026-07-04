import type { DownloadJob, ChunkInfo } from '../core/types';
import { getJobCardHtml, getFileIcon } from './components/JobCard';
import { updateTopbar } from './components/Topbar';
import { formatBytes, formatSpeed, formatETA } from './utils';

// Application State
let jobs: DownloadJob[] = [];
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
    if (res.ok) {
      jobs = await res.json();
      renderJobsGrid();
      updateStats();
      renderDetailPanel();
    }
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
    jobs = jobs.map((job) =>
      job.id === data.jobId
        ? {
            ...job,
            downloadedBytes: data.downloadedBytes,
            speed: data.speed,
            eta: data.eta,
            chunks: data.chunks || job.chunks,
            updatedAt: Date.now(),
          }
        : job
    );
    updateJobCardDOM(data.jobId);
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === 'job:status') {
    jobs = jobs.map((job) =>
      job.id === data.jobId
        ? {
            ...job,
            status: data.status,
            error: data.error,
            speed: 0,
            eta: -1,
            updatedAt: Date.now(),
          }
        : job
    );
    // Fetch detailed status refresh (e.g. chunk status updates)
    refreshJobDetails(data.jobId);
  } else if (data.type === 'job:added') {
    // Check if job already exists
    if (!jobs.some((job) => job.id === data.job.id)) {
      jobs.unshift(data.job);
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
  }
}

async function refreshJobDetails(jobId: string) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) {
      const refreshedJob = await res.json();
      jobs = jobs.map((j) => (j.id === jobId ? refreshedJob : j));
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

  detailTitle.textContent = 'Download Details';
  detailSubtitle.textContent = 'Job configuration';

  if (detailFileName) {
    detailFileName.textContent = job.filename;
    detailFileName.setAttribute('title', job.filename);
  }
  if (detailFilePath) {
    detailFilePath.textContent = job.destination;
    detailFilePath.setAttribute('title', job.destination);
  }
  if (detailFileIcon) {
    detailFileIcon.textContent = getFileIcon(job.filename);
  }

  // Populate detailed summary stats fields
  if (detailStatusVal) {
    detailStatusVal.textContent = job.status.toUpperCase();
    detailStatusVal.style.color = job.status === 'downloading' ? 'var(--accent)' : 
                                  job.status === 'completed' ? 'var(--success)' : 
                                  job.status === 'failed' ? 'var(--error)' : 'var(--muted)';
  }
  if (detailSpeedVal) {
    detailSpeedVal.textContent = job.status === 'downloading' ? formatSpeed(job.speed) : '--';
  }
  if (detailProgressVal) {
    detailProgressVal.textContent = `${formatBytes(job.downloadedBytes)} of ${job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'}`;
  }
  if (detailEtaVal) {
    detailEtaVal.textContent = job.status === 'downloading' ? formatETA(job.eta) : '--';
  }

  let chunkHtml = '';
  if (job.chunks && job.chunks.length > 0) {
    if (detailChunksTitle) {
      detailChunksTitle.textContent = `Parallel Chunks (${job.chunks.length} Threads)`;
    }
    chunkHtml = job.chunks
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
    inputUrl.focus();
  }
}

function hideAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.remove('visible');
    // Clear inputs
    inputUrl.value = '';
    inputName.value = '';
    inputOutput.value = '';
    inputChunks.value = '4';
    if (ytQualityGroup) {
      ytQualityGroup.style.display = 'none';
    }
  }
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
      alert('Please enter a valid file URL.');
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
