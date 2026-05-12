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
    downloadVideo(url, filename);
  };

  actionsDiv.appendChild(btn);

  itemDiv.appendChild(infoDiv);
  itemDiv.appendChild(actionsDiv);

  list.appendChild(itemDiv);
}

function downloadVideo(url, defaultFilename) {
  // Handle m3u8 specifically (HLS streams are usually not directly downloadable as single files)
  if (url.includes('.m3u8')) {
      alert("This is an HLS streaming playlist (.m3u8). Downloading it will only save the playlist file, not the full video. You typically need specialized software (like youtube-dl or ffmpeg) to download these.");
  }

  chrome.downloads.download({
    url: url,
    filename: defaultFilename,
    saveAs: true // Prompt the user for where to save
  });
}