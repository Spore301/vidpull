// Enable the side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

// Store detected videos. Map tabId -> set of URLs
const detectedVideos = new Map();

// Listen for network requests that might be videos
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Only care about main frame, sub_frame, media or xmlhttprequest
    const { tabId, url, type, responseHeaders } = details;

    if (tabId === -1) return; // Not related to a tab

    let isVideo = false;

    // Check request type
    if (type === 'media') {
      isVideo = true;
    }

    // Check response headers for content-type
    if (!isVideo && responseHeaders) {
      for (const header of responseHeaders) {
        if (header.name.toLowerCase() === 'content-type') {
          const contentType = header.value.toLowerCase();
          if (contentType.startsWith('video/') ||
              contentType === 'application/vnd.apple.mpegurl' || // m3u8
              contentType === 'application/x-mpegurl') {
            isVideo = true;
          }
          break;
        }
      }
    }

    // Fallback: Check extension if other methods failed
    if (!isVideo) {
      try {
        const urlObj = new URL(url);
        const path = urlObj.pathname.toLowerCase();
        if (path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.m3u8') || path.endsWith('.ts')) {
          isVideo = true;
        }
      } catch (e) {
        // Invalid URL
      }
    }

    if (isVideo) {
      if (!detectedVideos.has(tabId)) {
        detectedVideos.set(tabId, new Set());
      }

      const tabVideos = detectedVideos.get(tabId);
      if (!tabVideos.has(url)) {
        tabVideos.add(url);
        // Send message to update sidebar if it's open
        chrome.runtime.sendMessage({
          type: 'VIDEO_DETECTED',
          tabId: tabId,
          url: url
        }).catch(() => {
          // Ignore error if sidebar is not open
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedVideos.delete(tabId);
});

// Clean up or clear when a tab is refreshed/navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // New navigation started
    detectedVideos.delete(tabId);

    // Notify sidebar to clear
    chrome.runtime.sendMessage({
      type: 'TAB_UPDATED',
      tabId: tabId
    }).catch(() => {});
  }
});

// Provide the current list when requested
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_VIDEOS') {
    const tabId = request.tabId;
    const videos = detectedVideos.has(tabId) ? Array.from(detectedVideos.get(tabId)) : [];
    sendResponse({ videos: videos });
    return true;
  }
});
