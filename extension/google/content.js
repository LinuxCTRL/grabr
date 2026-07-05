let activeBadge = null;

// Guesses a filename from URL path
function guessFilename(url, defaultName = 'video.mp4') {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const parts = pathname.split('/');
    const lastPart = parts.pop();
    if (lastPart && lastPart.includes('.')) {
      return lastPart;
    }
  } catch {}
  return defaultName;
}

function injectBadge(video) {
  if (video.dataset.grabrInjected) return;
  video.dataset.grabrInjected = "true";

  // Create badge container
  const container = document.createElement('div');
  container.className = 'grabr-badge-container';

  const logo = document.createElement('div');
  logo.className = 'grabr-badge-logo';
  
  const text = document.createElement('span');
  text.className = 'grabr-badge-text';
  text.innerText = 'Download with Grabr';

  container.appendChild(logo);
  container.appendChild(text);

  // Position it relative to the video parent
  const parent = video.parentElement || document.body;
  
  // Make sure parent has relative positioning
  const originalPosition = window.getComputedStyle(parent).position;
  if (originalPosition === 'static') {
    parent.style.position = 'relative';
  }

  parent.appendChild(container);

  // Listen for click
  container.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        throw new Error("Grabr Extension context is invalidated.");
      }

      const videoUrl = video.src || '';
      if (videoUrl && !videoUrl.startsWith('blob:')) {
        const filename = guessFilename(videoUrl, document.title + '.mp4');
        chrome.runtime.sendMessage({
          type: 'open_grabr_popup',
          url: videoUrl,
          filename: filename,
          sizeBytes: 0
        });
      } else {
        // YouTube uses blob URLs, so let's send page URL if blob is detected
        const pageUrl = window.location.href;
        const filename = document.title ? document.title.replace(/[|\\/:*?"<>]/g, '') + '.mp4' : 'download.mp4';
        chrome.runtime.sendMessage({
          type: 'open_grabr_popup',
          url: pageUrl,
          filename: filename,
          sizeBytes: 0
        });
      }
    } catch (err) {
      alert("Grabr Extension has been reloaded or updated. Please refresh the page to continue!");
      console.error(err);
    }
  });

  // Hover visibility logic
  const handleMouseEnter = () => {
    container.classList.add('visible');
  };

  const handleMouseLeave = () => {
    container.classList.remove('visible');
  };

  parent.addEventListener('mouseenter', handleMouseEnter);
  parent.addEventListener('mouseleave', handleMouseLeave);
  video.addEventListener('play', handleMouseEnter);
}

// Periodically look for videos
function scanVideos() {
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    // Skip tiny videos like icons, ads
    if (video.offsetWidth > 150 && video.offsetHeight > 100) {
      injectBadge(video);
    }
  });
}

// Run scanner
setInterval(scanVideos, 1500);
scanVideos();
