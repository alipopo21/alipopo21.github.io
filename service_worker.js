const tabMediaLinks = new Map();
const storageArea = chrome.storage?.session ?? chrome.storage?.local ?? null;
const STORAGE_PREFIX = 'tabMedia:';

const initializationPromise = restoreFromStorage();

function storageKeyForTab(tabId) {
  return `${STORAGE_PREFIX}${tabId}`;
}

async function restoreFromStorage() {
  if (!storageArea) {
    return;
  }

  let stored = {};
  try {
    stored = await storageArea.get(null);
  } catch (error) {
    console.error('Failed to restore tab media links from storage', error);
    return;
  }

  Object.entries(stored)
    .filter(([key]) => key.startsWith(STORAGE_PREFIX))
    .forEach(([key, value]) => {
      const tabId = Number(key.slice(STORAGE_PREFIX.length));
      if (!Number.isInteger(tabId) || !value || typeof value !== 'object') {
        return;
      }

      const entry = new Map();
      Object.values(value).forEach((item) => {
        if (!item || !item.url) {
          return;
        }

        const normalizedUrl = String(item.url).trim();
        if (!normalizedUrl) {
          return;
        }

        entry.set(normalizedUrl, {
          url: normalizedUrl,
          types: new Set(Array.isArray(item.types) ? item.types : []),
          texts: new Set(Array.isArray(item.texts) ? item.texts : []),
          sources: new Set(Array.isArray(item.sources) ? item.sources : []),
          lastSeen: typeof item.lastSeen === 'number' ? item.lastSeen : Date.now()
        });
      });

      if (entry.size > 0) {
        tabMediaLinks.set(tabId, entry);
      }
    });
}

async function persistTab(tabId) {
  if (!storageArea) {
    return;
  }

  const key = storageKeyForTab(tabId);
  const entry = tabMediaLinks.get(tabId);

  if (!entry || entry.size === 0) {
    try {
      await storageArea.remove(key);
    } catch (error) {
      console.error('Failed to remove stored tab media links', error);
    }
    return;
  }

  const serialized = {};
  entry.forEach((item) => {
    serialized[item.url] = {
      url: item.url,
      types: Array.from(item.types),
      texts: Array.from(item.texts),
      sources: Array.from(item.sources),
      lastSeen: item.lastSeen
    };
  });

  try {
    await storageArea.set({ [key]: serialized });
  } catch (error) {
    console.error('Failed to persist tab media links', error);
  }
}

function ensureTabEntry(tabId) {
  if (!tabMediaLinks.has(tabId)) {
    tabMediaLinks.set(tabId, new Map());
  }
  return tabMediaLinks.get(tabId);
}

async function addLinksToTab(tabId, links) {
  if (!Array.isArray(links) || links.length === 0) {
    return;
  }

  const entry = ensureTabEntry(tabId);
  const now = Date.now();
  let changed = false;

  links.forEach((link) => {
    if (!link || !link.url) {
      return;
    }

    const normalizedUrl = link.url.trim();
    if (!normalizedUrl) {
      return;
    }

    const existing = entry.get(normalizedUrl);

    if (!existing) {
      const created = {
        url: normalizedUrl,
        types: new Set(),
        texts: new Set(),
        sources: new Set(),
        lastSeen: now
      };

      if (link.type) {
        created.types.add(link.type);
      }

      if (link.text) {
        created.texts.add(link.text.trim());
      }

      if (link.source) {
        created.sources.add(link.source);
      }

      entry.set(normalizedUrl, created);
      changed = true;
      return;
    }

    const previousTypeCount = existing.types.size;
    if (link.type) {
      existing.types.add(link.type);
    }

    const previousTextCount = existing.texts.size;
    if (link.text) {
      existing.texts.add(link.text.trim());
    }

    const previousSourceCount = existing.sources.size;
    if (link.source) {
      existing.sources.add(link.source);
    }

    if (
      existing.types.size !== previousTypeCount ||
      existing.texts.size !== previousTextCount ||
      existing.sources.size !== previousSourceCount
    ) {
      changed = true;
    }

    existing.lastSeen = now;
    changed = true;
    entry.set(normalizedUrl, existing);
  });

  if (changed) {
    await persistTab(tabId);
  }
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

async function clearTab(tabId) {
  if (tabMediaLinks.has(tabId)) {
    tabMediaLinks.delete(tabId);
  }

  await persistTab(tabId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  const senderTabId = sender && sender.tab ? sender.tab.id : undefined;

  initializationPromise
    .then(async () => {
      switch (message.type) {
        case 'links-found': {
          if (typeof senderTabId !== 'number') {
            sendResponse({ status: 'ignored' });
            break;
          }
          await addLinksToTab(senderTabId, message.links || []);
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
            await clearTab(target);
          }
          sendResponse({ status: 'cleared' });
          break;
        }
        default:
          sendResponse({ status: 'ignored' });
          break;
      }
    })
    .catch((error) => {
      console.error('Failed to process runtime message', error);
      sendResponse({ error: 'failed' });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  initializationPromise
    .then(() => clearTab(tabId))
    .catch((error) => console.error('Failed to clear removed tab', error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    initializationPromise
      .then(() => clearTab(tabId))
      .catch((error) => console.error('Failed to clear updated tab', error));
  }
});
