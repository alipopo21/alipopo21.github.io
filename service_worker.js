const tabMediaLinks = new Map();

function ensureTabEntry(tabId) {
  if (!tabMediaLinks.has(tabId)) {
    tabMediaLinks.set(tabId, new Map());
  }
  return tabMediaLinks.get(tabId);
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

    const normalizedUrl = link.url.trim();
    if (!normalizedUrl) {
      return;
    }

    const existing = entry.get(normalizedUrl) || {
      url: normalizedUrl,
      types: new Set(),
      texts: new Set(),
      sources: new Set(),
      lastSeen: now
    };

    if (link.type) {
      existing.types.add(link.type);
    }

    if (link.text) {
      existing.texts.add(link.text.trim());
    }

    if (link.source) {
      existing.sources.add(link.source);
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
      types: Array.from(item.types),
      texts: Array.from(item.texts),
      sources: Array.from(item.sources),
      lastSeen: item.lastSeen
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function clearTab(tabId) {
  if (tabMediaLinks.has(tabId)) {
    tabMediaLinks.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
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
      }
      sendResponse({ status: 'cleared' });
      break;
    }
    default:
      break;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearTab(tabId);
  }
});
