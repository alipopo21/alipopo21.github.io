(function () {
  const helpers = window.mediaLinkHelpers || {
    normalizeUrl: (url) => (typeof url === 'string' ? url : ''),
    collectFromNode: () => [],
    flattenLinksFromTree: () => [],
    collectFromMediaElement: () => []
  };

  const localUrlMeta = new Map();
  const trackedMediaElements = new WeakSet();
  let mutationObserver;
  let performanceObserver;

  function sendLinksToBackground(links) {
    if (!links.length || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'links-found', links });
  }

  function shouldSendLink(normalizedUrl, meta) {
    const existing = localUrlMeta.get(normalizedUrl);
    if (!existing) {
      const sets = {
        types: new Set(meta.type ? [meta.type] : []),
        sources: new Set(meta.source ? [meta.source] : []),
        texts: new Set(meta.text ? [meta.text] : [])
      };
      localUrlMeta.set(normalizedUrl, sets);
      return true;
    }

    let hasNewInfo = false;
    if (meta.type && !existing.types.has(meta.type)) {
      existing.types.add(meta.type);
      hasNewInfo = true;
    }
    if (meta.source && !existing.sources.has(meta.source)) {
      existing.sources.add(meta.source);
      hasNewInfo = true;
    }
    if (meta.text && !existing.texts.has(meta.text)) {
      existing.texts.add(meta.text);
      hasNewInfo = true;
    }
    return hasNewInfo;
  }

  function trackLinks(rawLinks, context = {}) {
    const newLinks = [];
    rawLinks.forEach((link) => {
      if (!link || !link.url) {
        return;
      }

      const normalized = helpers.normalizeUrl(link.url);
      if (!normalized) {
        return;
      }

      const type = link.type || context.type || 'unknown';
      const text = (link.text || context.text || '').trim();
      const sourceParts = [link.source || context.source || 'dom'];
      if (context.reason) {
        sourceParts.push(context.reason);
      }
      const source = sourceParts.filter(Boolean).join('::');
      const filename = link.filename || context.filename || '';

      if (!shouldSendLink(normalized, { type, source, text })) {
        return;
      }

      newLinks.push({
        url: normalized,
        type,
        text,
        source,
        filename
      });
    });

    if (newLinks.length) {
      sendLinksToBackground(newLinks);
    }
  }

  function collectAndTrackFromElement(element, reason) {
    if (!element) {
      return;
    }
    let links = [];
    try {
      const collector = helpers.collectFromMediaElement || helpers.collectFromNode;
      links = collector(element) || [];
    } catch (error) {
      links = [];
    }

    if (reason) {
      links = links.map((link) => ({
        ...link,
        source: [link.source, reason].filter(Boolean).join('::')
      }));
    }
    trackLinks(links);
  }

  function scanExistingDom() {
    const root = document.documentElement || document.body;
    const links = helpers.flattenLinksFromTree(root);
    trackLinks(links, { reason: 'initial-scan' });
    registerMediaElements(root);
  }

  function handleMutations(mutations) {
    const aggregated = [];
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          aggregated.push(...helpers.flattenLinksFromTree(node));
          registerMediaElements(node);
        });
      }
      if (mutation.type === 'attributes' && mutation.target) {
        aggregated.push(...helpers.collectFromNode(mutation.target));
        observePotentialMedia(mutation.target);
      }
    });
    trackLinks(aggregated, { reason: 'mutation' });
  }

  function initMutationObserver() {
    if (mutationObserver) {
      return;
    }
    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true
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
          trackLinks([{ url: input, type: 'fetch', source: 'network:fetch' }]);
        } else if (input && typeof input === 'object' && 'url' in input) {
          trackLinks([{ url: input.url, type: 'fetch', source: 'network:fetch' }]);
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
          trackLinks([{ url: requestUrl, type: 'xhr', source: 'network:xhr' }]);
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

  function hookSendBeacon() {
    if (!navigator || typeof navigator.sendBeacon !== 'function') {
      return;
    }
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function patchedSendBeacon(url, data) {
      try {
        trackLinks([{ url, type: 'beacon', source: 'network:beacon' }]);
      } catch (error) {
        // ignore
      }
      return originalSendBeacon(url, data);
    };
  }

  function hookElementProperty(proto, property, reason) {
    if (!proto) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor || typeof descriptor.set !== 'function') {
      return;
    }
    const originalSetter = descriptor.set;
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        originalSetter.call(this, value);
        try {
          collectAndTrackFromElement(this, reason);
        } catch (error) {
          // ignore
        }
      }
    });
  }

  function hookMediaSetters() {
    hookElementProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src', 'image-src-set');
    hookElementProperty(window.HTMLVideoElement && window.HTMLVideoElement.prototype, 'src', 'video-src-set');
    hookElementProperty(window.HTMLAudioElement && window.HTMLAudioElement.prototype, 'src', 'audio-src-set');
    hookElementProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'src', 'source-src-set');
  }

  function observePerformanceEntries() {
    if (typeof window.PerformanceObserver !== 'function') {
      return;
    }
    try {
      performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const links = entries
          .filter((entry) => entry && entry.name)
          .filter((entry) =>
            ['img', 'image', 'media', 'video', 'audio', 'fetch', 'xmlhttprequest'].includes((entry.initiatorType || '').toLowerCase())
          )
          .map((entry) => ({
            url: entry.name,
            type: entry.initiatorType || 'resource',
            source: 'performance'
          }));
        trackLinks(links);
      });
      performanceObserver.observe({ entryTypes: ['resource'] });
    } catch (error) {
      // ignore observer errors
    }
  }

  function observePotentialMedia(element) {
    if (!(element instanceof Element)) {
      return;
    }

    if (element.matches && element.matches('picture')) {
      element.querySelectorAll('img, source').forEach((child) => observePotentialMedia(child));
    }

    if (trackedMediaElements.has(element)) {
      return;
    }

    const isMediaElement = element.matches && element.matches('img, video, audio');
    const isSourceLike = element.matches && element.matches('source, track');
    const isEmbedded = element.matches && element.matches('iframe, object, embed');

    if (!isMediaElement && !isSourceLike && !isEmbedded) {
      return;
    }

    trackedMediaElements.add(element);

    const handler = (event) => collectAndTrackFromElement(element, event.type);

    if (element instanceof HTMLMediaElement) {
      ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'progress', 'play', 'durationchange'].forEach((eventName) => {
        element.addEventListener(eventName, handler, { passive: true });
      });
      element.addEventListener('error', handler, { passive: true });
      collectAndTrackFromElement(element, 'media-observed');
    } else if (element instanceof HTMLImageElement) {
      element.addEventListener('load', handler, { passive: true });
      element.addEventListener('error', handler, { passive: true });
      collectAndTrackFromElement(element, 'image-observed');
    } else if (isSourceLike || isEmbedded) {
      collectAndTrackFromElement(element, 'source-observed');
    }
  }

  function registerMediaElements(root) {
    if (!root) {
      return;
    }
    if (root instanceof Element) {
      observePotentialMedia(root);
      if (root.querySelectorAll) {
        root.querySelectorAll('img, video, audio, source, track, iframe, object, embed, picture').forEach((el) => {
          observePotentialMedia(el);
        });
      }
    } else if (root instanceof Document || root instanceof DocumentFragment) {
      const scope = root instanceof Document ? root.documentElement : root;
      if (scope && scope.querySelectorAll) {
        scope.querySelectorAll('img, video, audio, source, track, iframe, object, embed, picture').forEach((el) => {
          observePotentialMedia(el);
        });
      }
    }
  }

  function handleRescanRequest(sendResponse) {
    try {
      scanExistingDom();
      sendResponse({ status: 'rescanned' });
    } catch (error) {
      sendResponse({ status: 'error', message: error.message });
    }
  }

  function registerMessageListener() {
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) {
      return;
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) {
        return false;
      }
      if (message.type === 'rescan-links') {
        handleRescanRequest(sendResponse);
        return false;
      }
      if (message.type === 'clear-local-cache') {
        localUrlMeta.clear();
        sendResponse({ status: 'cleared' });
        return false;
      }
      return false;
    });
  }

  function bootstrap() {
    scanExistingDom();
    initMutationObserver();
    hookFetch();
    hookXHR();
    hookSendBeacon();
    hookMediaSetters();
    observePerformanceEntries();
    registerMessageListener();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
