// src/web/components/ProgressRing.ts
function getProgressRingHtml(percent, status) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - Math.max(0, Math.min(100, percent)) / 100 * circumference;
  let color = "var(--accent)";
  if (status === "completed")
    color = "var(--success)";
  if (status === "failed")
    color = "var(--error)";
  if (status === "paused")
    color = "#3b82f6";
  if (status === "queued")
    color = "var(--muted)";
  return `
    <svg class="progress-ring" width="50" height="50">
      <circle
        stroke="var(--border)"
        stroke-width="3.5"
        fill="transparent"
        r="${radius}"
        cx="25"
        cy="25"
      />
      <circle
        class="progress-ring__circle"
        stroke="${color}"
        stroke-width="3.5"
        fill="transparent"
        r="${radius}"
        cx="25"
        cy="25"
        style="
          stroke-dasharray: ${circumference};
          stroke-dashoffset: ${offset};
          transition: stroke-dashoffset 0.2s ease;
        "
      />
    </svg>
  `;
}

// src/web/utils.ts
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
function formatSpeed(bytesPerSec) {
  if (bytesPerSec <= 0)
    return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return `↓ ${parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function formatETA(seconds) {
  if (seconds === -1 || seconds === undefined || isNaN(seconds))
    return "unknown";
  if (seconds <= 0)
    return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => n.toString().padStart(2, "0");
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${m}:${pad(s)}`;
}

// src/web/components/JobCard.ts
function getJobCardHtml(job, isSelected) {
  const percent = job.totalBytes > 0 ? job.downloadedBytes / job.totalBytes * 100 : 0;
  const activeClass = isSelected ? "active" : "";
  let speedText = "--";
  let etaText = "--";
  if (job.status === "downloading") {
    speedText = formatSpeed(job.speed);
    etaText = `${formatETA(job.eta)} remaining`;
  } else if (job.status === "completed") {
    speedText = "Completed";
    etaText = "Done";
  } else if (job.status === "paused") {
    speedText = "Paused";
    etaText = "Resumable";
  } else if (job.status === "queued") {
    speedText = "Queued";
    etaText = "Waiting...";
  } else if (job.status === "failed") {
    speedText = "Failed";
    etaText = "Error occurred";
  }
  let actionButton = "";
  if (job.status === "downloading" || job.status === "queued") {
    actionButton = `
      <button class="action-btn btn-pause" data-action="pause" data-id="${job.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      </button>
    `;
  } else if (job.status === "paused" || job.status === "failed") {
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
          <span>of ${job.totalBytes > 0 ? formatBytes(job.totalBytes) : "Unknown"}</span>
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

// src/web/components/Topbar.ts
function updateTopbar(activeCount, totalSpeed) {
  const activeCountEl = document.getElementById("active-count");
  const totalSpeedEl = document.getElementById("total-speed");
  if (activeCountEl) {
    activeCountEl.textContent = activeCount.toString();
  }
  if (totalSpeedEl) {
    totalSpeedEl.textContent = formatSpeed(totalSpeed);
  }
}

// src/web/main.ts
var jobs = [];
var selectedJobId = null;
var ws = null;
var jobsGrid = document.getElementById("jobs-grid");
var addModalOverlay = document.getElementById("add-modal-overlay");
var btnOpenAdd = document.getElementById("btn-open-add");
var btnEmptyAdd = document.getElementById("btn-empty-add");
var btnCloseAdd = document.getElementById("btn-close-add");
var btnSubmitDownload = document.getElementById("btn-submit-download");
var btnClearCompleted = document.getElementById("btn-clear-completed");
var extensionModalOverlay = document.getElementById("extension-modal-overlay");
var btnGetExtension = document.getElementById("btn-get-extension");
var btnCloseExtension = document.getElementById("btn-close-extension");
var detailPanel = document.getElementById("detail-panel");
var detailTitle = document.getElementById("detail-title");
var detailSubtitle = document.getElementById("detail-subtitle");
var chunkGrid = document.getElementById("chunk-grid");
var btnCloseDetail = document.getElementById("btn-close-detail");
var inputUrl = document.getElementById("download-url");
var inputChunks = document.getElementById("download-chunks");
var inputName = document.getElementById("download-name");
var inputOutput = document.getElementById("download-output");
async function fetchJobs() {
  try {
    const res = await fetch("/api/jobs");
    if (res.ok) {
      jobs = await res.json();
      renderJobsGrid();
      updateStats();
      renderDetailPanel();
    }
  } catch (err) {
    console.error("Failed to fetch jobs:", err);
  }
}
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    console.log("WebSocket connected");
    fetchJobs();
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (err) {}
  };
  ws.onclose = () => {
    console.log("WebSocket disconnected. Reconnecting in 2s...");
    setTimeout(connectWebSocket, 2000);
  };
}
function handleWebSocketMessage(data) {
  if (data.type === "job:progress") {
    jobs = jobs.map((job) => job.id === data.jobId ? {
      ...job,
      downloadedBytes: data.downloadedBytes,
      speed: data.speed,
      eta: data.eta,
      chunks: data.chunks || job.chunks,
      updatedAt: Date.now()
    } : job);
    updateJobCardDOM(data.jobId);
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === "job:status") {
    jobs = jobs.map((job) => job.id === data.jobId ? {
      ...job,
      status: data.status,
      error: data.error,
      speed: 0,
      eta: -1,
      updatedAt: Date.now()
    } : job);
    refreshJobDetails(data.jobId);
  } else if (data.type === "job:added") {
    if (!jobs.some((job) => job.id === data.job.id)) {
      jobs.unshift(data.job);
      renderJobsGrid();
      updateStats();
    }
  } else if (data.type === "job:removed") {
    jobs = jobs.filter((job) => job.id !== data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      selectedJobId = null;
      renderDetailPanel();
    }
  } else if (data.type === "jobs:cleared") {
    fetchJobs();
  }
}
async function refreshJobDetails(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) {
      const refreshedJob = await res.json();
      jobs = jobs.map((j) => j.id === jobId ? refreshedJob : j);
      renderJobsGrid();
      updateStats();
      if (selectedJobId === jobId) {
        renderDetailPanel();
      }
    }
  } catch (err) {}
}
function updateJobCardDOM(jobId) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || !jobsGrid)
    return;
  const card = jobsGrid.querySelector(`[data-id="${jobId}"]`);
  if (card) {
    const isSelected = selectedJobId === jobId;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = getJobCardHtml(job, isSelected);
    const newCard = tempDiv.firstElementChild;
    if (newCard) {
      card.className = newCard.className;
      card.innerHTML = newCard.innerHTML;
    }
  }
}
function renderJobsGrid() {
  if (!jobsGrid)
    return;
  if (jobs.length === 0) {
    jobsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">↓</div>
        <p>No downloads yet.</p>
        <button id="btn-empty-add" class="btn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">Add one now</button>
      </div>
    `;
    const emptyBtn = document.getElementById("btn-empty-add");
    if (emptyBtn) {
      emptyBtn.addEventListener("click", showAddModal);
    }
    return;
  }
  const html = jobs.map((job) => getJobCardHtml(job, selectedJobId === job.id)).join("");
  jobsGrid.innerHTML = html;
}
function updateStats() {
  const activeCount = jobs.filter((j) => j.status === "downloading").length;
  const totalSpeed = jobs.filter((j) => j.status === "downloading").reduce((sum, j) => sum + j.speed, 0);
  updateTopbar(activeCount, totalSpeed);
}
function renderDetailPanel() {
  if (!detailPanel || !detailTitle || !detailSubtitle || !chunkGrid)
    return;
  if (!selectedJobId) {
    detailPanel.classList.remove("visible");
    return;
  }
  const job = jobs.find((j) => j.id === selectedJobId);
  if (!job) {
    detailPanel.classList.remove("visible");
    selectedJobId = null;
    return;
  }
  detailTitle.textContent = job.filename;
  detailSubtitle.textContent = `Save path: ${job.destination}`;
  let chunkHtml = "";
  if (job.chunks && job.chunks.length > 0) {
    chunkHtml = job.chunks.map((chunk) => {
      const chunkSize = chunk.end - chunk.start + 1;
      const percent = chunkSize > 0 ? chunk.downloaded / chunkSize * 100 : 0;
      return `
          <div class="chunk-card ${chunk.status}" data-chunk-index="${chunk.index}">
            <div class="chunk-header">
              <span>Chunk #${chunk.index + 1}</span>
              <span>${Math.round(percent)}%</span>
            </div>
            <div class="chunk-bar-container">
              <div class="chunk-bar" style="width: ${percent}%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--muted); font-family: var(--font-mono);">
              <span>${formatBytes(chunk.downloaded)}</span>
              <span>of ${formatBytes(chunkSize)}</span>
            </div>
          </div>
        `;
    }).join("");
  } else {
    chunkHtml = `<div style="grid-column: 1/-1; color: var(--muted); text-align: center; font-size: 0.85rem;">Single chunk stream</div>`;
  }
  chunkGrid.innerHTML = chunkHtml;
  detailPanel.classList.add("visible");
}
async function pauseJob(id) {
  try {
    await fetch(`/api/jobs/${id}/pause`, { method: "POST" });
  } catch (err) {
    console.error("Error pausing job:", err);
  }
}
async function resumeJob(id) {
  try {
    await fetch(`/api/jobs/${id}/resume`, { method: "POST" });
  } catch (err) {
    console.error("Error resuming job:", err);
  }
}
async function removeJob(id) {
  if (confirm("Are you sure you want to remove this download job?")) {
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Error removing job:", err);
    }
  }
}
async function clearCompleted() {
  try {
    await fetch("/api/jobs/clear-completed", { method: "POST" });
  } catch (err) {
    console.error("Error clearing jobs:", err);
  }
}
function showAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.add("visible");
    inputUrl.focus();
  }
}
function hideAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.remove("visible");
    inputUrl.value = "";
    inputName.value = "";
    inputOutput.value = "";
    inputChunks.value = "4";
  }
}
function showExtensionModal() {
  if (extensionModalOverlay) {
    extensionModalOverlay.classList.add("visible");
  }
}
function hideExtensionModal() {
  if (extensionModalOverlay) {
    extensionModalOverlay.classList.remove("visible");
  }
}
if (btnOpenAdd)
  btnOpenAdd.addEventListener("click", showAddModal);
if (btnCloseAdd)
  btnCloseAdd.addEventListener("click", hideAddModal);
if (btnGetExtension)
  btnGetExtension.addEventListener("click", showExtensionModal);
if (btnCloseExtension)
  btnCloseExtension.addEventListener("click", hideExtensionModal);
if (btnCloseDetail) {
  btnCloseDetail.addEventListener("click", () => {
    selectedJobId = null;
    renderDetailPanel();
    document.querySelectorAll(".job-card").forEach((card) => {
      card.classList.remove("active");
    });
  });
}
if (btnClearCompleted)
  btnClearCompleted.addEventListener("click", clearCompleted);
if (jobsGrid) {
  jobsGrid.addEventListener("click", (event) => {
    const target = event.target;
    const actionBtn = target.closest(".action-btn");
    if (actionBtn) {
      const action = actionBtn.getAttribute("data-action");
      const id = actionBtn.getAttribute("data-id");
      if (!id || !action)
        return;
      if (action === "pause") {
        pauseJob(id);
      } else if (action === "resume") {
        resumeJob(id);
      } else if (action === "remove") {
        removeJob(id);
      }
    } else {
      const card = target.closest(".job-card");
      if (card) {
        const id = card.getAttribute("data-id");
        if (id) {
          selectedJobId = id;
          document.querySelectorAll(".job-card").forEach((el) => {
            if (el.getAttribute("data-id") === id) {
              el.classList.add("active");
            } else {
              el.classList.remove("active");
            }
          });
          renderDetailPanel();
        }
      }
    }
  });
}
if (btnSubmitDownload) {
  btnSubmitDownload.addEventListener("click", async () => {
    const url = inputUrl.value.trim();
    if (!url) {
      alert("Please enter a valid file URL.");
      return;
    }
    const chunks = parseInt(inputChunks.value, 10) || 4;
    const name = inputName.value.trim() || undefined;
    const outputDir = inputOutput.value.trim() || undefined;
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url,
          options: {
            chunks,
            filename: name,
            outputDir
          }
        })
      });
      if (res.ok) {
        hideAddModal();
      } else {
        const errText = await res.text();
        alert(`Failed to add job: ${errText}`);
      }
    } catch (err) {
      alert(`Network error adding job: ${err.message}`);
    }
  });
}
var btnThemeToggle = document.getElementById("btn-theme-toggle");
var themeToggleIcon = document.getElementById("theme-toggle-icon");
function initTheme() {
  const savedTheme = localStorage.getItem("grabr-theme") || "dark";
  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
    if (themeToggleIcon)
      themeToggleIcon.textContent = "\uD83C\uDF19";
  } else {
    document.body.classList.remove("light-theme");
    if (themeToggleIcon)
      themeToggleIcon.textContent = "☀️";
  }
}
if (btnThemeToggle) {
  btnThemeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem("grabr-theme", isLight ? "light" : "dark");
    if (themeToggleIcon) {
      themeToggleIcon.textContent = isLight ? "\uD83C\uDF19" : "☀️";
    }
  });
}
initTheme();
connectWebSocket();
