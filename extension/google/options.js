// UI Elements
const enabledInput = document.getElementById('enabled');
const serverUrlInput = document.getElementById('server-url');
const interceptAllInput = document.getElementById('intercept-all');
const fileTypesInput = document.getElementById('file-types');
const fileTypesGroup = document.getElementById('file-types-group');
const defaultChunksInput = document.getElementById('default-chunks');
const minSizeMbInput = document.getElementById('min-size-mb');
const defaultOutputDirInput = document.getElementById('default-output-dir');

const btnSave = document.getElementById('btn-save');
const statusMsg = document.getElementById('status-msg');

// Toggle visibility of file types based on intercept-all checkbox
interceptAllInput.addEventListener('change', () => {
  if (interceptAllInput.checked) {
    fileTypesGroup.style.display = 'none';
  } else {
    fileTypesGroup.style.display = 'flex';
  }
});

// Load saved settings
function restoreOptions() {
  chrome.storage.local.get({
    enabled: true,
    serverUrl: 'http://127.0.0.1:7474',
    interceptAll: false,
    fileTypes: 'zip,rar,tar,gz,7z,dmg,pkg,iso,exe,msi,pdf,mp4,mkv,avi,mp3',
    defaultChunks: 4,
    minSizeMb: 0,
    defaultOutputDir: ''
  }, (items) => {
    enabledInput.checked = items.enabled;
    serverUrlInput.value = items.serverUrl;
    interceptAllInput.checked = items.interceptAll;
    fileTypesInput.value = items.fileTypes;
    defaultChunksInput.value = items.defaultChunks;
    minSizeMbInput.value = items.minSizeMb;
    defaultOutputDirInput.value = items.defaultOutputDir;

    // Trigger toggle visibility logic
    if (items.interceptAll) {
      fileTypesGroup.style.display = 'none';
    } else {
      fileTypesGroup.style.display = 'flex';
    }
  });
}

// Save settings to storage
function saveOptions() {
  const enabled = enabledInput.checked;
  let serverUrl = serverUrlInput.value.trim() || 'http://127.0.0.1:7474';
  
  // Ensure protocol is present
  if (!/^https?:\/\//i.test(serverUrl)) {
    serverUrl = 'http://' + serverUrl;
  }

  const interceptAll = interceptAllInput.checked;
  const fileTypes = fileTypesInput.value.trim();
  const defaultChunks = parseInt(defaultChunksInput.value, 10) || 4;
  const minSizeMb = parseFloat(minSizeMbInput.value) || 0;
  const defaultOutputDir = defaultOutputDirInput.value.trim();

  chrome.storage.local.set({
    enabled,
    serverUrl,
    interceptAll,
    fileTypes,
    defaultChunks,
    minSizeMb,
    defaultOutputDir
  }, () => {
    // Show success message
    statusMsg.classList.add('show');
    setTimeout(() => {
      statusMsg.classList.remove('show');
    }, 2000);
  });
}

// Listeners
document.addEventListener('DOMContentLoaded', restoreOptions);
btnSave.addEventListener('click', saveOptions);
