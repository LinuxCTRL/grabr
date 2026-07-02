// Parse query parameters
const params = new URLSearchParams(window.location.search);
const downloadUrl = params.get('url');
const defaultFilename = params.get('filename') || '';
const totalBytes = parseInt(params.get('size') || '0', 10);

// Layout Containers
const downloadLayout = document.getElementById('download-layout');
const statusLayout = document.getElementById('status-layout');

// UI Elements (Common)
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
let serverUrl = 'http://localhost:7474';
let ws = null;

// Helper to format file size
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper to format speed
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

// Helper to format ETA
function formatETA(seconds) {
  if (seconds === undefined || seconds === null || seconds < 0 || seconds === Infinity) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
}

// -------------------------------------------------------------
// DUAL MODE BRANCHING
// -------------------------------------------------------------
if (downloadUrl) {
  // -----------------------------------------------------------
  // 1. DOWNLOAD MODE (Opened as dialog window)
  // -----------------------------------------------------------
  downloadLayout.style.display = 'flex';
  
  const fileUrlEl = document.getElementById('file-url');
  const fileSizeEl = document.getElementById('file-size');
  const filenameInput = document.getElementById('filename');
  const outputDirInput = document.getElementById('output-dir');
  const chunksInput = document.getElementById('chunks');
  const errorAlert = document.getElementById('error-alert');
  const btnCancel = document.getElementById('btn-cancel');
  const btnChrome = document.getElementById('btn-chrome');
  const btnGrabr = document.getElementById('btn-grabr');

  fileUrlEl.textContent = downloadUrl;
  filenameInput.value = defaultFilename;
  fileSizeEl.textContent = formatBytes(totalBytes);

  chrome.storage.local.get({
    serverUrl: 'http://localhost:7474',
    defaultChunks: 4,
    defaultOutputDir: ''
  }, (settings) => {
    serverUrl = settings.serverUrl.replace(/\/$/, '');
    chunksInput.value = settings.defaultChunks;
    outputDirInput.value = settings.defaultOutputDir;

    checkDownloadDaemonStatus(btnGrabr, errorAlert);
  });

  btnCancel.addEventListener('click', () => window.close());
  
  btnChrome.addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      type: 'download_chrome', 
      url: downloadUrl 
    }, () => {
      window.close();
    });
  });

  btnGrabr.addEventListener('click', async () => {
    btnGrabr.setAttribute('disabled', 'true');
    btnGrabr.textContent = 'Sending...';
    errorAlert.style.display = 'none';

    const filename = filenameInput.value.trim();
    const outputDir = outputDirInput.value.trim();
    const chunks = parseInt(chunksInput.value, 10) || 4;

    const options = {};
    if (filename) options.filename = filename;
    if (outputDir) options.outputDir = outputDir;
    options.chunks = chunks;

    try {
      const response = await fetch(`${serverUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: downloadUrl, options })
      });

      if (response.ok) {
        // Trigger a badge update immediately
        chrome.runtime.sendMessage({ type: 'update_badge' }, () => {
          window.close();
        });
      } else {
        const errMsg = await response.text();
        throw new Error(errMsg || `Status ${response.status}`);
      }
    } catch (err) {
      btnGrabr.removeAttribute('disabled');
      btnGrabr.textContent = 'Send to Grabr';
      errorAlert.textContent = `Failed to start download: ${err.message}`;
      errorAlert.style.display = 'block';
    }
  });

} else {
  // -----------------------------------------------------------
  // 2. STATUS MODE (Opened from extension toolbar icon)
  // -----------------------------------------------------------
  document.body.classList.add('toolbar-popup');
  statusLayout.style.display = 'flex';

  const daemonUrlDisplay = document.getElementById('daemon-url-display');
  const toggleActive = document.getElementById('toggle-active');
  const toggleInterceptAll = document.getElementById('toggle-intercept-all');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnOpenWebui = document.getElementById('btn-open-webui');
  const activeDownloadsSection = document.getElementById('active-downloads-section');
  const activeJobsList = document.getElementById('active-jobs-list');

  chrome.storage.local.get({
    enabled: true,
    interceptAll: false,
    serverUrl: 'http://localhost:7474'
  }, (items) => {
    serverUrl = items.serverUrl.replace(/\/$/, '');
    daemonUrlDisplay.textContent = serverUrl;
    toggleActive.checked = items.enabled;
    toggleInterceptAll.checked = items.interceptAll;

    checkStatusDaemonStatus(btnOpenWebui, activeDownloadsSection, activeJobsList);
  });

  // Save options on toggle change
  toggleActive.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggleActive.checked });
  });

  toggleInterceptAll.addEventListener('change', () => {
    chrome.storage.local.set({ interceptAll: toggleInterceptAll.checked });
  });

  // Action buttons
  btnOpenOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  btnOpenWebui.addEventListener('click', () => {
    chrome.tabs.query({}, (tabs) => {
      const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(serverUrl));
      if (existingTab) {
        chrome.tabs.update(existingTab.id, { active: true });
        chrome.windows.update(existingTab.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: serverUrl });
      }
      window.close();
    });
  });
}

// -------------------------------------------------------------
// CONNECTION STATUS & MINI-DASHBOARD HELPERS
// -------------------------------------------------------------
async function checkDownloadDaemonStatus(submitBtn, errorEl) {
  try {
    const response = await fetch(`${serverUrl}/api/jobs`);
    if (response.ok) {
      statusBadge.classList.add('online');
      statusText.textContent = 'Daemon Active';
      submitBtn.removeAttribute('disabled');
      errorEl.style.display = 'none';
    } else {
      throw new Error();
    }
  } catch {
    statusBadge.classList.remove('online');
    statusText.textContent = 'Daemon Offline';
    submitBtn.setAttribute('disabled', 'true');
    errorEl.textContent = `Could not connect to Grabr Daemon at ${serverUrl}. Make sure it is running via 'grabr daemon start'.`;
    errorEl.style.display = 'block';
  }
}

async function checkStatusDaemonStatus(webuiBtn, sectionEl, listEl) {
  try {
    const response = await fetch(`${serverUrl}/api/jobs`);
    if (response.ok) {
      statusBadge.classList.add('online');
      statusText.textContent = 'Daemon Active';
      webuiBtn.removeAttribute('disabled');
      
      // Load jobs initially
      const jobs = await response.json();
      renderActiveJobs(jobs, sectionEl, listEl);
      
      // Connect real-time WebSocket dashboard
      connectWebSocket(sectionEl, listEl);
    } else {
      throw new Error();
    }
  } catch (err) {
    statusBadge.classList.remove('online');
    statusText.textContent = 'Daemon Offline';
    webuiBtn.setAttribute('disabled', 'true');
    sectionEl.style.display = 'none';
  }
}

// Render the active/downloading jobs in the list
function renderActiveJobs(jobs, sectionEl, listEl) {
  // Filter for downloading, queued, paused, failed
  const activeJobs = jobs.filter(j => j.status !== 'completed');
  
  if (activeJobs.length === 0) {
    sectionEl.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  sectionEl.style.display = 'flex';
  listEl.innerHTML = '';

  activeJobs.forEach(job => {
    const percent = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0;
    const row = document.createElement('div');
    row.className = `mini-job-row ${job.status}`;
    row.id = `job-${job.id}`;
    row.innerHTML = `
      <div class="mini-job-header">
        <span class="mini-job-name" title="${job.filename}">${job.filename}</span>
        <div class="mini-job-actions">
          <button class="mini-action-btn btn-toggle-state" data-id="${job.id}" data-status="${job.status}">
            ${job.status === 'downloading' || job.status === 'queued' ? getPauseIcon() : getPlayIcon()}
          </button>
          <button class="mini-action-btn btn-delete" data-id="${job.id}">
            ${getDeleteIcon()}
          </button>
        </div>
      </div>
      <div class="mini-job-progress-bar-bg">
        <div class="mini-job-progress-bar ${job.status}" id="bar-${job.id}" style="width: ${percent}%"></div>
      </div>
      <div class="mini-job-stats">
        <span id="speed-eta-${job.id}">
          ${job.status === 'downloading' ? `${formatSpeed(job.speed)} • ${formatETA(job.eta)}` : capitalizeFirst(job.status)}
        </span>
        <span id="percent-size-${job.id}">
          ${Math.round(percent)}% (${formatBytes(job.downloadedBytes)} / ${job.totalBytes > 0 ? formatBytes(job.totalBytes) : 'Unknown'})
        </span>
      </div>
    `;

    // Hook events
    row.querySelector('.btn-toggle-state').addEventListener('click', toggleJobState);
    row.querySelector('.btn-delete').addEventListener('click', deleteJob);

    listEl.appendChild(row);
  });
}

// Websocket connection to keep dashboard synced in real time
function connectWebSocket(sectionEl, listEl) {
  const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws';
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'job:progress') {
        updateProgressRow(data);
      } else if (data.type === 'job:status') {
        // Reload list when a job's status completes/changes
        refreshJobsList(sectionEl, listEl);
      } else if (data.type === 'job:added' || data.type === 'job:removed' || data.type === 'jobs:cleared') {
        refreshJobsList(sectionEl, listEl);
      }
    };

    ws.onclose = () => {
      // Reconnect in 5s if popup is still open
      setTimeout(() => {
        if (document.body.classList.contains('toolbar-popup')) {
          connectWebSocket(sectionEl, listEl);
        }
      }, 5000);
    };
  } catch (err) {
    console.error('WS Connection error:', err);
  }
}

// Fast UI updates on progress events
function updateProgressRow(data) {
  const { jobId, downloadedBytes, totalBytes, speed, eta } = data;
  const bar = document.getElementById(`bar-${jobId}`);
  const speedEta = document.getElementById(`speed-eta-${jobId}`);
  const percentSize = document.getElementById(`percent-size-${jobId}`);
  
  if (bar && speedEta && percentSize) {
    const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
    bar.style.width = `${percent}%`;
    speedEta.textContent = `${formatSpeed(speed)} • ${formatETA(eta)}`;
    percentSize.textContent = `${Math.round(percent)}% (${formatBytes(downloadedBytes)} / ${totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'})`;
  }
}

// Reload helper
async function refreshJobsList(sectionEl, listEl) {
  try {
    const response = await fetch(`${serverUrl}/api/jobs`);
    if (response.ok) {
      const jobs = await response.json();
      renderActiveJobs(jobs, sectionEl, listEl);
      
      // Keep extension badge updated
      chrome.runtime.sendMessage({ type: 'update_badge' });
    }
  } catch {}
}

// -------------------------------------------------------------
// CONTROL BUTTONS LOGIC
// -------------------------------------------------------------
async function toggleJobState(e) {
  const btn = e.currentTarget;
  const id = btn.getAttribute('data-id');
  const currentStatus = btn.getAttribute('data-status');
  
  btn.setAttribute('disabled', 'true');

  const action = (currentStatus === 'downloading' || currentStatus === 'queued') ? 'pause' : 'resume';
  try {
    const response = await fetch(`${serverUrl}/api/jobs/${id}/${action}`, { method: 'POST' });
    if (response.ok) {
      // Background WS broadcast triggers reload, but we update badge instantly
      chrome.runtime.sendMessage({ type: 'update_badge' });
    }
  } catch (err) {
    console.error('Failed to toggle job state:', err);
  } finally {
    btn.removeAttribute('disabled');
  }
}

async function deleteJob(e) {
  const btn = e.currentTarget;
  const id = btn.getAttribute('data-id');
  
  if (!confirm('Are you sure you want to delete this job?')) return;
  
  btn.setAttribute('disabled', 'true');
  try {
    const response = await fetch(`${serverUrl}/api/jobs/${id}`, { method: 'DELETE' });
    if (response.ok) {
      chrome.runtime.sendMessage({ type: 'update_badge' });
    }
  } catch (err) {
    console.error('Failed to delete job:', err);
  } finally {
    btn.removeAttribute('disabled');
  }
}

// -------------------------------------------------------------
// SVG ICON HELPERS
// -------------------------------------------------------------
function getPauseIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
  </svg>`;
}

function getPlayIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>`;
}

function getDeleteIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>`;
}

function capitalizeFirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
