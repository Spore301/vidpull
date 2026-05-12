let currentTabId = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get the current active tab
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    refreshVideos();
  }
});

// Update current tab when switching tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  currentTabId = activeInfo.tabId;
  refreshVideos();
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'VIDEO_DETECTED' && message.tabId === currentTabId) {
    addVideoToList(message.url);
  } else if (message.type === 'TAB_UPDATED' && message.tabId === currentTabId) {
    clearVideoList();
  }
});

function refreshVideos() {
  if (!currentTabId) return;

  clearVideoList();

  chrome.runtime.sendMessage({ type: 'GET_VIDEOS', tabId: currentTabId }, (response) => {
    if (response && response.videos) {
      response.videos.forEach(url => addVideoToList(url));
    }
  });
}

function clearVideoList() {
  const list = document.getElementById('video-list');
  list.innerHTML = '';
  document.getElementById('empty-state').style.display = 'flex';
}

function addVideoToList(url) {
  document.getElementById('empty-state').style.display = 'none';
  const list = document.getElementById('video-list');

  // Prevent duplicates in UI
  const existingUrls = Array.from(list.querySelectorAll('.item-date')).map(el => el.title);
  if (existingUrls.includes(url)) return;

  // Use a heuristic for filename based on URL
  let filename = "video.mp4"; // default
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && lastPart.includes('.')) {
      filename = lastPart;
    }
  } catch (e) {
    // Ignore URL parsing errors
  }

  const itemDiv = document.createElement('div');
  itemDiv.className = 'library-item animate-fade-in';

  const infoDiv = document.createElement('div');
  infoDiv.className = 'item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'item-name';
  nameEl.textContent = filename;
  nameEl.title = filename;

  const urlEl = document.createElement('div');
  urlEl.className = 'item-date';
  urlEl.textContent = url;
  urlEl.title = url;

  infoDiv.appendChild(nameEl);
  infoDiv.appendChild(urlEl);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'item-actions';

  const btn = document.createElement('button');
  btn.className = 'action-button primary video-download-btn';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    Download
  `;
  btn.onclick = () => {
    downloadVideo(url, filename, itemDiv);
  };

  actionsDiv.appendChild(btn);

  itemDiv.appendChild(infoDiv);
  itemDiv.appendChild(actionsDiv);

  list.appendChild(itemDiv);
}

function downloadVideo(url, defaultFilename, itemDiv) {
  if (url.includes('.m3u8')) {
    downloadHLS(url, defaultFilename, itemDiv);
  } else {
    chrome.downloads.download({
      url: url,
      filename: defaultFilename,
      saveAs: true
    });
  }
}

async function downloadHLS(playlistUrl, defaultFilename, itemDiv) {
  const btn = itemDiv.querySelector('.video-download-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;

  try {
    btn.textContent = 'Fetching playlist...';

    // 1. Fetch the initial m3u8
    let response = await fetch(playlistUrl);
    let playlistContent = await response.text();
    let baseUrl = new URL('.', playlistUrl).href;

    // 2. Check if it's a master playlist (contains EXT-X-STREAM-INF)
    if (playlistContent.includes('#EXT-X-STREAM-INF')) {
      // Find the highest quality stream
      const lines = playlistContent.split('\n');
      let highestBandwidth = 0;
      let bestStreamUrl = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          const match = line.match(/BANDWIDTH=(\d+)/);
          if (match && parseInt(match[1]) > highestBandwidth) {
            highestBandwidth = parseInt(match[1]);
            bestStreamUrl = lines[i+1].trim();
          }
        }
      }

      if (bestStreamUrl) {
        if (!bestStreamUrl.startsWith('http')) {
           bestStreamUrl = new URL(bestStreamUrl, baseUrl).href;
        }
        playlistUrl = bestStreamUrl;
        baseUrl = new URL('.', playlistUrl).href;
        response = await fetch(playlistUrl);
        playlistContent = await response.text();
      }
    }

    // 3. Parse media playlist for segment URLs (.ts, .m4s, etc)
    const lines = playlistContent.split('\n');
    const segments = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        let segmentUrl = trimmed;
        if (!segmentUrl.startsWith('http')) {
          segmentUrl = new URL(segmentUrl, baseUrl).href;
        }
        segments.push(segmentUrl);
      }
    }

    if (segments.length === 0) {
      throw new Error('No segments found in playlist');
    }

    // 4. Download all segments
    const total = segments.length;
    const buffers = [];

    for (let i = 0; i < segments.length; i++) {
      btn.textContent = `Downloading... ${Math.round((i / total) * 100)}%`;

      const segRes = await fetch(segments[i]);
      if (!segRes.ok) throw new Error(`Failed to fetch segment ${i}`);
      const arrayBuffer = await segRes.arrayBuffer();
      buffers.push(arrayBuffer);
    }

    btn.textContent = 'Processing...';

    // 5. Concatenate buffers
    const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    // 6. Create Blob and Download
    // Note: The resulting file is usually an MPEG-TS stream.
    // Changing extension from .m3u8 to .ts is safer.
    let finalFilename = defaultFilename;
    if (finalFilename.endsWith('.m3u8')) {
       finalFilename = finalFilename.replace('.m3u8', '.ts');
    }

    const blob = new Blob([combined], { type: 'video/mp2t' });
    const objectUrl = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: objectUrl,
      filename: finalFilename,
      saveAs: true
    }, () => {
      // Cleanup object URL after a short delay
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    });

    btn.innerHTML = originalHtml;
    btn.disabled = false;

  } catch (err) {
    console.error(err);
    alert('Failed to download HLS stream: ' + err.message);
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}