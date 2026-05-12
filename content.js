// Store already found URLs to avoid spamming the background script
const foundUrls = new Set();

function extractVideoUrls() {
  const urls = [];

  // Find all video tags
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    // Check the src of the video tag itself
    if (video.src && !video.src.startsWith('blob:') && !foundUrls.has(video.src)) {
      urls.push(video.src);
      foundUrls.add(video.src);
    }

    // Check for source tags inside the video
    const sources = video.querySelectorAll('source');
    sources.forEach(source => {
      if (source.src && !source.src.startsWith('blob:') && !foundUrls.has(source.src)) {
        urls.push(source.src);
        foundUrls.add(source.src);
      }
    });
  });

  // Find audio tags just in case
  const audios = document.querySelectorAll('audio');
  audios.forEach(audio => {
     if (audio.src && !audio.src.startsWith('blob:') && !foundUrls.has(audio.src)) {
      urls.push(audio.src);
      foundUrls.add(audio.src);
    }
    const sources = audio.querySelectorAll('source');
    sources.forEach(source => {
      if (source.src && !source.src.startsWith('blob:') && !foundUrls.has(source.src)) {
        urls.push(source.src);
        foundUrls.add(source.src);
      }
    });
  });

  // If we found any new ones, send them to the background script
  if (urls.length > 0) {
    try {
      chrome.runtime.sendMessage({
        type: 'DOM_VIDEOS_DETECTED',
        urls: urls
      });
    } catch (e) {
      // Ignore errors if background script is not ready/reloaded
    }
  }
}

// Run initially
extractVideoUrls();

// Set up an observer to watch for DOM changes (dynamically added videos)
const observer = new MutationObserver((mutations) => {
  let shouldCheck = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        // If it's an element node
        if (node.nodeType === 1) {
          if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO' || node.tagName === 'SOURCE' || node.querySelector('video, audio, source')) {
             shouldCheck = true;
             break;
          }
        }
      }
    }
    if (shouldCheck) break;
  }

  if (shouldCheck) {
    extractVideoUrls();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});