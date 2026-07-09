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
function getFileIcon(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext)
    return "⬇️";
  if (["zip", "rar", "tar", "gz", "7z", "dmg", "pkg", "iso"].includes(ext))
    return "\uD83D\uDCE6";
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext))
    return "\uD83C\uDFA5";
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return "\uD83C\uDFB5";
  if (["exe", "msi", "sh", "bat"].includes(ext))
    return "⚙️";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md"].includes(ext))
    return "\uD83D\uDCC4";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext))
    return "\uD83D\uDDBC️";
  return "⬇️";
}
function isTorrentJob(job) {
  return job.type === "torrent";
}
function getJobCardHtml(job, isSelected) {
  const isTorrent = isTorrentJob(job);
  const totalBytes = isTorrent ? job.totalLength : job.totalBytes;
  const downloadedBytes = isTorrent ? job.downloaded : job.downloadedBytes;
  const filename = isTorrent ? job.name : job.filename;
  const status = job.status;
  const percent = totalBytes > 0 ? downloadedBytes / totalBytes * 100 : 0;
  const activeClass = isSelected ? "active" : "";
  let speedText = "--";
  let etaText = "--";
  if (status === "downloading") {
    speedText = isTorrent ? `${formatSpeed(job.speed)} | ${job.peers} peers` : formatSpeed(job.speed);
    etaText = formatETA(job.eta);
  } else if (status === "completed") {
    speedText = "Completed";
    etaText = "Done";
  } else if (status === "paused") {
    speedText = "Paused";
    etaText = "Resumable";
  } else if (status === "queued") {
    speedText = "Queued";
    etaText = "Waiting...";
  } else if (status === "failed") {
    speedText = "Failed";
    etaText = "Error";
  } else if (status === "seeding") {
    speedText = "Seeding";
    etaText = "₿";
  }
  let actionButton = "";
  if (status === "downloading" || status === "queued") {
    actionButton = `
      <button class="btn-action-icon action-btn" data-action="pause" data-id="${job.id}" title="Pause">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    `;
  } else if (status === "paused" || status === "failed" || status === "seeding") {
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
  const icon = isTorrent ? "\uD83E\uDDF2" : getFileIcon(filename);
  const sizeText = `${formatBytes(downloadedBytes)} of ${totalBytes > 0 ? formatBytes(totalBytes) : "Unknown"}`;
  const badge = isTorrent ? '<span class="torrent-badge">TORRENT</span>' : "";
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
function isTorrentJob2(job) {
  return job.type === "torrent";
}
function getJobFilename(job) {
  return isTorrentJob2(job) ? job.name : job.filename;
}
function getJobTotalBytes(job) {
  return isTorrentJob2(job) ? job.totalLength : job.totalBytes;
}
function getJobDownloadedBytes(job) {
  return isTorrentJob2(job) ? job.downloaded : job.downloadedBytes;
}
var jobs = [];
var selectedJobId = null;
var ws = null;
var activeFilter = "all";
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
var detailStatusVal = document.getElementById("detail-status-val");
var detailSpeedVal = document.getElementById("detail-speed-val");
var detailProgressVal = document.getElementById("detail-progress-val");
var detailEtaVal = document.getElementById("detail-eta-val");
var detailChunksTitle = document.getElementById("detail-chunks-title");
var detailFileName = document.getElementById("detail-file-name");
var detailFilePath = document.getElementById("detail-file-path");
var detailFileIcon = document.getElementById("detail-file-icon");
var detailTorrentInfo = document.getElementById("detail-torrent-info");
var detailInfoHash = document.getElementById("detail-info-hash");
var detailPeers = document.getElementById("detail-peers");
var detailSeedRatio = document.getElementById("detail-seed-ratio");
var detailTorrentFiles = document.getElementById("detail-torrent-files");
var inputUrl = document.getElementById("download-url");
var inputChunks = document.getElementById("download-chunks");
var inputName = document.getElementById("download-name");
var inputOutput = document.getElementById("download-output");
var ytQualityGroup = document.getElementById("yt-quality-group");
var downloadQuality = document.getElementById("download-quality");
async function fetchJobs() {
  try {
    const res = await fetch("/api/jobs");
    const allJobs = res.ok ? await res.json() : [];
    jobs = allJobs;
    renderJobsGrid();
    updateStats();
    renderDetailPanel();
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
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      if (isTorrentJob2(job)) {
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
  } else if (data.type === "job:status") {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      return Object.assign(job, { status: data.status, error: data.error, speed: 0, eta: -1, updatedAt: Date.now() });
    });
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
  } else if (data.type.startsWith("torrent:")) {
    handleTorrentWebSocketMessage(data);
  }
}
function handleTorrentWebSocketMessage(data) {
  if (data.type === "torrent:progress") {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      return Object.assign(job, {
        downloaded: data.downloaded,
        speed: data.speed,
        eta: data.eta,
        progress: data.progress,
        peers: data.peers,
        updatedAt: Date.now()
      });
    });
    updateJobCardDOM(data.jobId);
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === "torrent:done") {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      return Object.assign(job, { status: "seeding", progress: 1, speed: 0, updatedAt: Date.now() });
    });
    updateJobCardDOM(data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === "torrent:error") {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      return Object.assign(job, { status: "failed", error: data.error, updatedAt: Date.now() });
    });
    refreshJobDetails(data.jobId);
  } else if (data.type === "torrent:status") {
    jobs = jobs.map((job) => {
      if (job.id !== data.jobId)
        return job;
      return Object.assign(job, { status: data.status, updatedAt: Date.now() });
    });
    updateJobCardDOM(data.jobId);
    renderJobsGrid();
    if (selectedJobId === data.jobId) {
      renderDetailPanel();
    }
  } else if (data.type === "torrent:removed") {
    jobs = jobs.filter((job) => job.id !== data.jobId);
    renderJobsGrid();
    updateStats();
    if (selectedJobId === data.jobId) {
      selectedJobId = null;
      renderDetailPanel();
    }
  }
}
async function refreshJobDetails(jobId) {
  try {
    const job = jobs.find((j) => j.id === jobId);
    if (!job)
      return;
    const endpoint = isTorrentJob2(job) ? `/api/torrents/${jobId}` : `/api/jobs/${jobId}`;
    const res = await fetch(endpoint);
    if (res.ok) {
      const refreshedJob = await res.json();
      jobs = jobs.map((j) => j.id === jobId ? { ...j, ...refreshedJob } : j);
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
  let filteredJobs = jobs;
  if (activeFilter === "downloading") {
    filteredJobs = jobs.filter((j) => j.status === "downloading");
  } else if (activeFilter === "completed") {
    filteredJobs = jobs.filter((j) => j.status === "completed");
  } else if (activeFilter === "paused") {
    filteredJobs = jobs.filter((j) => j.status === "paused");
  }
  if (filteredJobs.length === 0) {
    jobsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">↓</div>
        <p>No ${activeFilter !== "all" ? activeFilter : ""} downloads yet.</p>
        ${activeFilter === "all" ? '<button id="btn-empty-add" class="btn" style="padding: 0.5rem 1rem; font-size: 0.85rem;">Add one now</button>' : ""}
      </div>
    `;
    if (activeFilter === "all") {
      const emptyBtn = document.getElementById("btn-empty-add");
      if (emptyBtn) {
        emptyBtn.addEventListener("click", showAddModal);
      }
    }
    return;
  }
  const html = filteredJobs.map((job) => getJobCardHtml(job, selectedJobId === job.id)).join("");
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
  const isTorrent = isTorrentJob2(job);
  const filename = getJobFilename(job);
  const totalBytes = getJobTotalBytes(job);
  const downloadedBytes = getJobDownloadedBytes(job);
  detailTitle.textContent = isTorrent ? "Torrent Details" : "Download Details";
  detailSubtitle.textContent = isTorrent ? "Torrent job information" : "Job configuration";
  if (detailFileName) {
    detailFileName.textContent = filename;
    detailFileName.setAttribute("title", filename);
  }
  if (detailFilePath) {
    const dest = isTorrent ? "" : job.destination;
    detailFilePath.textContent = dest;
    detailFilePath.setAttribute("title", dest);
  }
  if (detailFileIcon) {
    detailFileIcon.textContent = isTorrent ? "\uD83E\uDDF2" : getFileIcon(filename);
  }
  if (detailStatusVal) {
    detailStatusVal.textContent = job.status.toUpperCase();
    detailStatusVal.style.color = job.status === "downloading" ? "var(--accent)" : job.status === "completed" ? "var(--success)" : job.status === "failed" ? "var(--error)" : job.status === "seeding" ? "#22c55e" : "var(--muted)";
  }
  if (detailSpeedVal) {
    detailSpeedVal.textContent = job.status === "downloading" ? formatSpeed(job.speed) : "--";
  }
  if (detailProgressVal) {
    detailProgressVal.textContent = `${formatBytes(downloadedBytes)} of ${totalBytes > 0 ? formatBytes(totalBytes) : "Unknown"}`;
  }
  if (detailEtaVal) {
    detailEtaVal.textContent = job.status === "downloading" ? formatETA(job.eta) : "--";
  }
  if (isTorrent && detailTorrentInfo) {
    const t = job;
    detailChunksTitle.textContent = "Torrent Files";
    if (detailInfoHash)
      detailInfoHash.textContent = t.infoHash;
    if (detailPeers)
      detailPeers.textContent = String(t.peers ?? 0);
    if (detailSeedRatio)
      detailSeedRatio.textContent = String(t.seedRatio ?? 0);
    detailTorrentInfo.style.display = "block";
    if (detailTorrentFiles && t.files) {
      detailTorrentFiles.innerHTML = t.files.map((f, i) => `
        <div class="torrent-file-row" data-idx="${i}" data-selected="${f.selected}" title="${f.path}">
          <span class="torrent-file-idx">#${i}</span>
          <span class="torrent-file-path">${f.path}</span>
          <span class="torrent-file-size">${formatBytes(f.length)}</span>
          <span class="torrent-file-status ${f.selected ? "selected" : "deselected"}">${f.selected ? "✓" : "✗"}</span>
        </div>
      `).join("");
    }
    chunkGrid.innerHTML = "";
  } else {
    if (detailTorrentInfo)
      detailTorrentInfo.style.display = "none";
    let chunkHtml = "";
    const d = job;
    if (d.chunks && d.chunks.length > 0) {
      if (detailChunksTitle) {
        detailChunksTitle.textContent = `Parallel Chunks (${d.chunks.length} Threads)`;
      }
      chunkHtml = d.chunks.map((chunk) => {
        const chunkSize = chunk.end - chunk.start + 1;
        const percent = chunkSize > 0 ? chunk.downloaded / chunkSize * 100 : 0;
        const tooltip = `Chunk #${chunk.index + 1}: ${Math.round(percent)}% (${formatBytes(chunk.downloaded)} / ${formatBytes(chunkSize)})`;
        return `
            <div class="chunk-block ${chunk.status}" data-chunk-index="${chunk.index}" data-tooltip="${tooltip}"></div>
          `;
      }).join("");
    } else {
      if (detailChunksTitle) {
        detailChunksTitle.textContent = "Parallel Chunks";
      }
      chunkHtml = `<div style="grid-column: 1/-1; color: var(--muted); text-align: center; font-size: 0.8rem;">Single chunk stream</div>`;
    }
    chunkGrid.innerHTML = chunkHtml;
  }
  const torrentFilesContainer = document.getElementById("detail-torrent-files");
  if (torrentFilesContainer) {
    torrentFilesContainer.onclick = async (e) => {
      const row = e.target.closest(".torrent-file-row");
      if (!row)
        return;
      const idx = parseInt(row.getAttribute("data-idx") || "", 10);
      if (isNaN(idx))
        return;
      const isSelected = row.getAttribute("data-selected") === "true";
      try {
        await fetch(`/api/torrents/${selectedJobId}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ indices: [idx], selected: !isSelected })
        });
      } catch {}
    };
  }
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
    hideTorrentFileSelection();
    modalTabs.forEach((t) => t.classList.remove("active"));
    const urlTab = document.querySelector('.modal-tab[data-tab="url"]');
    if (urlTab)
      urlTab.classList.add("active");
    if (tabUrl)
      tabUrl.style.display = "flex";
    if (tabTorrent)
      tabTorrent.style.display = "none";
    if (tabUrlActions)
      tabUrlActions.style.display = "flex";
    if (tabTorrentActions)
      tabTorrentActions.style.display = "none";
    inputUrl.focus();
  }
}
function hideAddModal() {
  if (addModalOverlay) {
    addModalOverlay.classList.remove("visible");
    hideTorrentFileSelection();
    inputUrl.value = "";
    inputName.value = "";
    inputOutput.value = "";
    inputChunks.value = "4";
    if (torrentUrlInput)
      torrentUrlInput.value = "";
    if (ytQualityGroup) {
      ytQualityGroup.style.display = "none";
    }
  }
}
var addedTorrentJob = null;
var modalTabs = document.querySelectorAll(".modal-tab");
var tabUrl = document.getElementById("tab-url");
var tabTorrent = document.getElementById("tab-torrent");
var tabUrlActions = document.getElementById("tab-url-actions");
var tabTorrentActions = document.getElementById("tab-torrent-actions");
var torrentUrlInput = document.getElementById("torrent-url");
var btnAddTorrent = document.getElementById("btn-add-torrent-url");
var torrentFilesSection = document.getElementById("torrent-files-section");
var torrentFileListModal = document.getElementById("torrent-file-list-modal");
var selectAllFiles = document.getElementById("select-all-files");
var btnCancelTorrent = document.getElementById("btn-cancel-torrent");
var btnStartTorrent = document.getElementById("btn-start-torrent");
var btnCloseAdd2 = document.getElementById("btn-close-add-2");
modalTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    modalTabs.forEach((t2) => t2.classList.remove("active"));
    tab.classList.add("active");
    const t = tab.getAttribute("data-tab");
    if (t === "url") {
      if (tabUrl)
        tabUrl.style.display = "flex";
      if (tabTorrent)
        tabTorrent.style.display = "none";
      if (tabUrlActions)
        tabUrlActions.style.display = "flex";
      if (tabTorrentActions)
        tabTorrentActions.style.display = "none";
    } else {
      if (tabUrl)
        tabUrl.style.display = "none";
      if (tabTorrent)
        tabTorrent.style.display = "flex";
      if (tabUrlActions)
        tabUrlActions.style.display = "none";
      if (tabTorrentActions)
        tabTorrentActions.style.display = "flex";
    }
    hideTorrentFileSelection();
  });
});
function showTorrentFileSelection(job) {
  addedTorrentJob = job;
  if (torrentFilesSection)
    torrentFilesSection.style.display = "block";
  if (torrentUrlInput)
    torrentUrlInput.style.display = "none";
  if (btnAddTorrent)
    btnAddTorrent.style.display = "none";
  if (torrentFileListModal && job.files) {
    torrentFileListModal.innerHTML = job.files.map((f, i) => `
      <label class="torrent-file-row-modal" data-idx="${i}">
        <input type="checkbox" class="file-checkbox" data-idx="${i}" ${f.selected ? "checked" : ""}>
        <span class="file-path">${f.path}</span>
        <span class="file-size">${formatBytes(f.length)}</span>
      </label>
    `).join("");
  }
  if (selectAllFiles)
    selectAllFiles.checked = true;
}
function hideTorrentFileSelection() {
  addedTorrentJob = null;
  if (torrentFilesSection)
    torrentFilesSection.style.display = "none";
  if (torrentUrlInput)
    torrentUrlInput.style.display = "";
  if (btnAddTorrent)
    btnAddTorrent.style.display = "";
  if (torrentFileListModal)
    torrentFileListModal.innerHTML = "";
  torrentFileDataUrl = null;
  if (torrentFileName) {
    torrentFileName.textContent = "";
    torrentFileName.style.display = "none";
  }
  if (torrentDropZone) {
    const content = torrentDropZone.querySelector(".torrent-drop-content");
    if (content)
      content.style.display = "";
  }
  if (torrentFileInput)
    torrentFileInput.value = "";
}
if (selectAllFiles) {
  selectAllFiles.addEventListener("change", () => {
    const checkboxes = document.querySelectorAll(".file-checkbox");
    checkboxes.forEach((cb) => {
      cb.checked = selectAllFiles.checked;
    });
  });
}
if (torrentFileListModal) {
  torrentFileListModal.addEventListener("change", () => {
    const checkboxes = document.querySelectorAll(".file-checkbox");
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    if (selectAllFiles)
      selectAllFiles.checked = allChecked;
  });
}
var torrentFileInput = document.getElementById("torrent-file-input");
var torrentDropZone = document.getElementById("torrent-drop-zone");
var torrentFileName = document.getElementById("torrent-file-name");
var torrentFileDataUrl = null;
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader;
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function handleTorrentFile(file) {
  if (!file.name.toLowerCase().endsWith(".torrent") && file.type !== "application/x-bittorrent") {
    alert("Please select a valid .torrent file.");
    return;
  }
  readFileAsDataURL(file).then((dataUrl) => {
    torrentFileDataUrl = dataUrl;
    if (torrentFileName) {
      torrentFileName.textContent = `\uD83D\uDCC4 ${file.name} (${formatBytes(file.size)})`;
      torrentFileName.style.display = "block";
    }
    if (torrentDropZone) {
      const content = torrentDropZone.querySelector(".torrent-drop-content");
      if (content)
        content.style.display = "none";
    }
  }).catch((err) => {
    alert(`Failed to read file: ${err.message}`);
  });
}
if (torrentFileInput) {
  torrentFileInput.addEventListener("change", () => {
    const file = torrentFileInput.files?.[0];
    if (file)
      handleTorrentFile(file);
  });
}
if (torrentDropZone) {
  torrentDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    torrentDropZone.classList.add("drag-over");
  });
  torrentDropZone.addEventListener("dragleave", () => {
    torrentDropZone.classList.remove("drag-over");
  });
  torrentDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    torrentDropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file)
      handleTorrentFile(file);
  });
}
if (btnAddTorrent) {
  btnAddTorrent.addEventListener("click", async () => {
    const textUrl = (torrentUrlInput?.value || "").trim();
    const url = torrentFileDataUrl || textUrl;
    if (!url) {
      alert("Please enter a magnet link, torrent URL, or select a .torrent file.");
      return;
    }
    if (btnAddTorrent) {
      btnAddTorrent.textContent = "Loading...";
      btnAddTorrent.disabled = true;
    }
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
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
    } catch (err) {
      alert(`Network error adding torrent: ${err.message}`);
    } finally {
      if (btnAddTorrent) {
        btnAddTorrent.textContent = "Add Torrent";
        btnAddTorrent.disabled = false;
      }
    }
  });
}
if (btnStartTorrent) {
  btnStartTorrent.addEventListener("click", async () => {
    if (!addedTorrentJob)
      return;
    const jobId = addedTorrentJob.id;
    const checkboxes = document.querySelectorAll(".file-checkbox");
    const selectedIndices = [];
    const deselectedIndices = [];
    checkboxes.forEach((cb) => {
      const idx = parseInt(cb.getAttribute("data-idx") || "", 10);
      if (!isNaN(idx)) {
        if (cb.checked)
          selectedIndices.push(idx);
        else
          deselectedIndices.push(idx);
      }
    });
    if (deselectedIndices.length > 0) {
      try {
        await fetch(`/api/torrents/${jobId}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ indices: deselectedIndices, selected: false })
        });
      } catch {}
    }
    hideAddModal();
  });
}
if (btnCancelTorrent) {
  btnCancelTorrent.addEventListener("click", () => {
    if (addedTorrentJob) {
      fetch(`/api/jobs/${addedTorrentJob.id}`, { method: "DELETE" }).catch(() => {});
    }
    hideTorrentFileSelection();
  });
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
if (btnCloseAdd2)
  btnCloseAdd2.addEventListener("click", hideAddModal);
if (addModalOverlay) {
  addModalOverlay.addEventListener("click", (e) => {
    if (e.target === addModalOverlay)
      hideAddModal();
  });
}
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
if (inputUrl && ytQualityGroup) {
  inputUrl.addEventListener("input", () => {
    const val = inputUrl.value.trim();
    if (val.includes("youtube.com") || val.includes("youtu.be")) {
      ytQualityGroup.style.display = "block";
    } else {
      ytQualityGroup.style.display = "none";
    }
  });
}
if (btnSubmitDownload) {
  btnSubmitDownload.addEventListener("click", async () => {
    let url = inputUrl.value.trim();
    if (!url) {
      alert("Please enter a valid URL or magnet link.");
      return;
    }
    if (ytQualityGroup && ytQualityGroup.style.display === "block" && downloadQuality) {
      const selectedFormat = downloadQuality.value;
      url = `${url}#format=${encodeURIComponent(selectedFormat)}`;
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
async function checkUpdates() {
  const banner = document.getElementById("update-banner");
  const versionsSpan = document.getElementById("update-versions");
  const closeBtn = document.getElementById("btn-close-update");
  if (!banner || !versionsSpan)
    return;
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      banner.style.display = "none";
    });
  }
  try {
    const currentRes = await fetch("/api/version");
    if (!currentRes.ok)
      return;
    const currentData = await currentRes.json();
    const currentVer = currentData.version;
    const latestRes = await fetch("https://registry.npmjs.org/@linuxctrl/grabr/latest");
    if (!latestRes.ok)
      return;
    const latestData = await latestRes.json();
    const latestVer = latestData.version;
    const isNewer = (curr, lat) => {
      const c = curr.split(".").map(Number);
      const l = lat.split(".").map(Number);
      for (let i = 0;i < 3; i++) {
        const cVal = c[i] ?? 0;
        const lVal = l[i] ?? 0;
        if (lVal > cVal)
          return true;
        if (lVal < cVal)
          return false;
      }
      return false;
    };
    if (isNewer(currentVer, latestVer)) {
      versionsSpan.textContent = `v${latestVer} (installed: v${currentVer})`;
      banner.style.display = "flex";
    }
  } catch (err) {}
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
    activeFilter = item.getAttribute("data-filter") || "all";
    renderJobsGrid();
  });
});
initTheme();
connectWebSocket();
checkUpdates();
