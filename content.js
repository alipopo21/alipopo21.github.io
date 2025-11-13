(function () {
  const helpers = window.mediaLinkHelpers || {
    normalizeUrl: (url) => url,
    collectFromNode: () => [],
    flattenLinksFromTree: () => []
  };

  const discoveredUrls = new Set();
  let mutationObserver;

  function sendLinksToBackground(links) {
    if (!links.length || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'links-found', links });
  }

  function trackLinks(rawLinks) {
    const newLinks = [];
    rawLinks.forEach((link) => {
      if (!link || !link.url) {
        return;
      }
      const normalized = helpers.normalizeUrl(link.url);
      if (!normalized || discoveredUrls.has(normalized)) {
        return;
      }
      discoveredUrls.add(normalized);
      newLinks.push({
        url: normalized,
        type: link.type || 'unknown',
        text: link.text || '',
        source: link.source || 'dom'
      });
    });

    if (newLinks.length) {
      sendLinksToBackground(newLinks);
    }
  }

  function scanExistingDom() {
    const links = helpers.flattenLinksFromTree(document.documentElement || document.body);
    trackLinks(links);
  }

  function handleMutations(mutations) {
    const aggregated = [];
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          aggregated.push(...helpers.flattenLinksFromTree(node));
        });
      }
      if (mutation.type === 'attributes' && mutation.target) {
        aggregated.push(...helpers.collectFromNode(mutation.target));
      }
    });
    trackLinks(aggregated);
  }

  function initMutationObserver() {
    if (mutationObserver) {
      return;
    }
    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'data-src', 'poster', 'style']
    });
  }

  function hookFetch() {
    if (typeof window.fetch !== 'function') {
      return;
    }
    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(input, init) {
      try {
        if (typeof input === 'string') {
          trackLinks([{ url: input, type: 'fetch', source: 'network' }]);
        } else if (input && typeof input === 'object' && 'url' in input) {
          trackLinks([{ url: input.url, type: 'fetch', source: 'network' }]);
        }
      } catch (error) {
        // Ignore normalization errors
      }
      return originalFetch.apply(this, arguments);
    };
  }

  function hookXHR() {
    if (typeof window.XMLHttpRequest !== 'function') {
      return;
    }
    const OriginalXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhrInstance = new OriginalXHR();
      let requestUrl = '';

      const originalOpen = xhrInstance.open;
      xhrInstance.open = function patchedOpen(method, url) {
        requestUrl = url || '';
        return originalOpen.apply(this, arguments);
      };

      const originalSend = xhrInstance.send;
      xhrInstance.send = function patchedSend() {
        if (requestUrl) {
          trackLinks([{ url: requestUrl, type: 'xhr', source: 'network' }]);
        }
        return originalSend.apply(this, arguments);
      };

      return xhrInstance;
    }

    PatchedXHR.UNSENT = OriginalXHR.UNSENT;
    PatchedXHR.OPENED = OriginalXHR.OPENED;
    PatchedXHR.HEADERS_RECEIVED = OriginalXHR.HEADERS_RECEIVED;
    PatchedXHR.LOADING = OriginalXHR.LOADING;
    PatchedXHR.DONE = OriginalXHR.DONE;
    PatchedXHR.prototype = OriginalXHR.prototype;

    window.XMLHttpRequest = PatchedXHR;
  }

  function bootstrap() {
    scanExistingDom();
    initMutationObserver();
    hookFetch();
    hookXHR();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
