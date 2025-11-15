const tabMediaLinks = new Map();

function normalizeUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed).href;
  } catch (error) {
    return trimmed;
  }
}

function deriveFilename(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.split('/').filter(Boolean);
    const lastSegment = pathname[pathname.length - 1];
    if (lastSegment) {
      return decodeURIComponent(lastSegment.split('?')[0]);
    }
  } catch (error) {
    // ignore errors and fall through
  }
  return 'media-file';
}

function ensureTabEntry(tabId) {
  if (!tabMediaLinks.has(tabId)) {
    tabMediaLinks.set(tabId, new Map());
  }
  return tabMediaLinks.get(tabId);
}

function ensureSet(value) {
  if (value instanceof Set) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Set(value);
  }
  return new Set(value ? [value] : []);
}

function addLinksToTab(tabId, links) {
  if (!Array.isArray(links) || links.length === 0) {
    return;
  }

  const entry = ensureTabEntry(tabId);
  const now = Date.now();

  links.forEach((link) => {
    if (!link || !link.url) {
      return;
    }

    const normalizedUrl = normalizeUrl(link.url);
    if (!normalizedUrl) {
      return;
    }

    const existing = entry.get(normalizedUrl) || {
      url: normalizedUrl,
      types: new Set(),
      texts: new Set(),
      sources: new Set(),
      filename: deriveFilename(normalizedUrl),
      lastSeen: now
    };

    existing.types = ensureSet(existing.types);
    existing.texts = ensureSet(existing.texts);
    existing.sources = ensureSet(existing.sources);

    if (link.type) {
      existing.types.add(String(link.type));
    }

    if (link.text) {
      existing.texts.add(String(link.text).trim());
    }

    if (link.source) {
      existing.sources.add(String(link.source));
    }

    if (link.filename && !existing.filename) {
      existing.filename = link.filename;
    }

    existing.lastSeen = now;
    entry.set(normalizedUrl, existing);
  });
}

function serializeTabLinks(tabId) {
  const entry = tabMediaLinks.get(tabId);
  if (!entry) {
    return [];
  }

  return Array.from(entry.values())
    .map((item) => ({
      url: item.url,
      types: Array.from(item.types || []),
      texts: Array.from(item.texts || []),
      sources: Array.from(item.sources || []),
      filename: item.filename || deriveFilename(item.url),
      lastSeen: item.lastSeen
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function clearTab(tabId) {
  if (tabMediaLinks.has(tabId)) {
    tabMediaLinks.delete(tabId);
  }
}

function notifyTabCleared(tabId) {
  if (!chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
    return;
  }
  try {
    chrome.tabs.sendMessage(tabId, { type: 'clear-local-cache' }, () => {
      const error = chrome.runtime.lastError;
      if (error && error.message && !error.message.includes('Receiving end does not exist')) {
        console.debug('clear-local-cache notification', error.message);
      }
    });
  } catch (error) {
    // Ignore failures when tab is no longer available
  }
}

function handleDownloadLinks(payload, sendResponse) {
  const requestedLinks = Array.isArray(payload.links) ? payload.links : [];
  if (!requestedLinks.length) {
    sendResponse({ status: 'no-links', downloaded: 0, failed: [] });
    return false;
  }

  if (!chrome.downloads || typeof chrome.downloads.download !== 'function') {
    sendResponse({ status: 'unavailable', downloaded: 0, failed: requestedLinks });
    return false;
  }

  const unique = [];
  const seen = new Set();
  requestedLinks.forEach((link) => {
    if (!link || !link.url) {
      return;
    }
    const normalizedUrl = normalizeUrl(link.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    unique.push({
      url: normalizedUrl,
      filename: link.filename || deriveFilename(normalizedUrl)
    });
  });

  if (!unique.length) {
    sendResponse({ status: 'no-links', downloaded: 0, failed: [] });
    return false;
  }

  const result = { status: 'done', downloaded: 0, failed: [] };
  let remaining = unique.length;

  unique.forEach((item) => {
    try {
      chrome.downloads.download(
        {
          url: item.url,
          filename: item.filename,
          saveAs: false,
          conflictAction: 'uniquify'
        },
        (downloadId) => {
          const error = chrome.runtime.lastError;
          if (error || typeof downloadId !== 'number') {
            result.failed.push({ url: item.url, error: error ? error.message : 'unknown-error' });
          } else {
            result.downloaded += 1;
          }

          remaining -= 1;
          if (remaining === 0) {
            sendResponse(result);
          }
        }
      );
    } catch (error) {
      result.failed.push({ url: item.url, error: error.message || 'unexpected-error' });
      remaining -= 1;
      if (remaining === 0) {
        sendResponse(result);
      }
    }
  });

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  const senderTabId = sender && sender.tab ? sender.tab.id : undefined;

  switch (message.type) {
    case 'links-found': {
      if (typeof senderTabId !== 'number') {
        break;
      }
      addLinksToTab(senderTabId, message.links || []);
      sendResponse({ status: 'stored' });
      break;
    }
    case 'get-links': {
      const targetTabId = typeof message.tabId === 'number' ? message.tabId : senderTabId;
      const links = typeof targetTabId === 'number' ? serializeTabLinks(targetTabId) : [];
      sendResponse({ links });
      break;
    }
    case 'reset-tab': {
      const target = typeof message.tabId === 'number' ? message.tabId : senderTabId;
      if (typeof target === 'number') {
        clearTab(target);
        notifyTabCleared(target);
      }
      sendResponse({ status: 'cleared' });
      break;
    }
    case 'download-links':
      return handleDownloadLinks(message, sendResponse);
    default:
      break;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (typeof removedTabId === 'number') {
    clearTab(removedTabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTab(tabId);
    notifyTabCleared(tabId);
  }
});
