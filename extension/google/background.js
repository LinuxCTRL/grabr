const ignoredDownloads = new Set();

// Helper to check if a URL is HTTP/HTTPS
function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper to open the Grabr download prompt dialog window centered
function openGrabrPopup(downloadUrl, filename = '', sizeBytes = 0) {
  const width = 540;
  const height = 500;

  chrome.windows.getLastFocused((lastFocusedWindow) => {
    let top = 100;
    let left = 100;
    if (lastFocusedWindow) {
      top = Math.round(lastFocusedWindow.top + (lastFocusedWindow.height - height) / 2);
      left = Math.round(lastFocusedWindow.left + (lastFocusedWindow.width - width) / 2);
    }

    const cleanFilename = filename ? filename.split(/[\\/]/).pop() : '';

    const popupUrl = chrome.runtime.getURL('popup.html') +
      `?url=${encodeURIComponent(downloadUrl)}` +
      `&filename=${encodeURIComponent(cleanFilename)}` +
      `&size=${sizeBytes}`;

    chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width: width,
      height: height,
      top: top,
      left: left,
      focused: true
    });
  });
}

// -------------------------------------------------------------
// CONTEXT MENUS SETUP
// -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  // 1. Context menu for links
  chrome.contextMenus.create({
    id: 'send-to-grabr',
    title: 'Send link to Grabr',
    contexts: ['link']
  });

  // 2. Context menu for selected text (batch links downloader)
  chrome.contextMenus.create({
    id: 'download-selected-links',
    title: 'Download links in selection with Grabr',
    contexts: ['selection']
  });

  // Start the alarm for updating the badge
  chrome.alarms.create('update-badge', { periodInMinutes: 1 });
  updateBadge();
});

// Listen for context menu click events
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-grabr') {
    const linkUrl = info.linkUrl;
    if (linkUrl && isHttpUrl(linkUrl)) {
      let guessedFilename = '';
      try {
        const urlObj = new URL(linkUrl);
        guessedFilename = urlObj.pathname.split('/').pop() || '';
      } catch {}
      openGrabrPopup(linkUrl, guessedFilename, 0);
    }
  } else if (info.menuItemId === 'download-selected-links') {
    const selectionText = info.selectionText;
    if (selectionText) {
      batchDownloadLinks(selectionText);
    }
  }
});

// Helper to batch extract URLs from text and send to Grabr
function batchDownloadLinks(text) {
  const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
  const urls = text.match(urlRegex) || [];
  const validUrls = urls.filter(isHttpUrl);

  if (validUrls.length === 0) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Grabr Integration',
      message: 'No valid HTTP/HTTPS links found in the selected text.'
    });
    return;
  }

  chrome.storage.local.get({
    serverUrl: 'http://localhost:7474',
    defaultChunks: 4
  }, async (settings) => {
    const serverUrl = settings.serverUrl.replace(/\/$/, '');
    let successCount = 0;

    chrome.notifications.create('batch-start', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Grabr Integration',
      message: `Found ${validUrls.length} links. Sending to Grabr...`
    });

    for (const url of validUrls) {
      let filename = '';
      try {
        const urlObj = new URL(url);
        filename = urlObj.pathname.split('/').pop() || '';
      } catch {}

      try {
        const response = await fetch(`${serverUrl}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            options: {
              chunks: settings.defaultChunks,
              ...(filename ? { filename } : {})
            }
          })
        });
        if (response.ok) {
          successCount++;
        }
      } catch (err) {
        console.error('Failed to post URL to daemon:', url, err);
      }
    }

    chrome.notifications.create('batch-complete', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Grabr Integration',
      message: `Successfully sent ${successCount} of ${validUrls.length} downloads to Grabr!`
    });

    updateBadge();
  });
}

// -------------------------------------------------------------
// DYNAMIC BADGE COUNT
// -------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'update-badge') {
    updateBadge();
  }
});

async function updateBadge() {
  chrome.storage.local.get({
    serverUrl: 'http://localhost:7474'
  }, async (settings) => {
    const serverUrl = settings.serverUrl.replace(/\/$/, '');
    try {
      const response = await fetch(`${serverUrl}/api/jobs`);
      if (response.ok) {
        const jobs = await response.json();
        const activeCount = jobs.filter(j => j.status === 'downloading').length;

        chrome.action.setBadgeText({
          text: activeCount > 0 ? activeCount.toString() : ''
        });
        chrome.action.setBadgeBackgroundColor({
          color: '#f59e0b' // Amber accent
        });
      } else {
        throw new Error();
      }
    } catch {
      // Clear badge if offline
      chrome.action.setBadgeText({ text: '' });
    }
  });
}

// Update badge when the extension is active/loaded
chrome.runtime.onStartup.addListener(updateBadge);

// -------------------------------------------------------------
// AUTOMATIC DOWNLOAD INTERCEPTOR
// -------------------------------------------------------------
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (downloadItem.byExtensionId === chrome.runtime.id) {
    return;
  }

  if (ignoredDownloads.has(downloadItem.url)) {
    ignoredDownloads.delete(downloadItem.url);
    return;
  }

  const downloadUrl = downloadItem.finalUrl || downloadItem.url;
  if (!isHttpUrl(downloadUrl)) {
    return;
  }

  chrome.storage.local.get({
    enabled: true,
    serverUrl: 'http://localhost:7474',
    interceptAll: false,
    fileTypes: 'zip,rar,tar,gz,7z,dmg,pkg,iso,exe,msi,pdf,mp4,mkv,avi,mp3',
    minSizeMb: 0
  }, (settings) => {
    if (!settings.enabled) return;

    if (settings.minSizeMb > 0 && downloadItem.totalBytes > 0) {
      const sizeMb = downloadItem.totalBytes / (1024 * 1024);
      if (sizeMb < settings.minSizeMb) {
        return;
      }
    }

    const filename = downloadItem.filename || '';
    const ext = filename.split('.').pop().toLowerCase();
    const allowedTypes = settings.fileTypes.split(',').map(t => t.trim().toLowerCase());
    const shouldIntercept = settings.interceptAll || allowedTypes.includes(ext);

    if (!shouldIntercept) return;

    chrome.downloads.cancel(downloadItem.id, () => {
      chrome.downloads.erase({ id: downloadItem.id });
    });

    openGrabrPopup(downloadUrl, downloadItem.filename, downloadItem.totalBytes || 0);
  });
});

// Listen for messages from popup dialog
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'download_chrome') {
    ignoredDownloads.add(message.url);
    chrome.downloads.download({ url: message.url });
    sendResponse({ success: true });
  } else if (message.type === 'update_badge') {
    updateBadge();
    sendResponse({ success: true });
  }
});
