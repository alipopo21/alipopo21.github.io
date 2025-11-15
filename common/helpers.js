(function () {
  const MEDIA_ATTRIBUTES = [
    'src',
    'data-src',
    'data-original',
    'data-url',
    'data-href',
    'poster',
    'data-poster',
    'data-thumb',
    'data-preview',
    'data-background',
    'data-bg',
    'data-image',
    'data-video',
    'data-audio',
    'data-file',
    'data-stream'
  ];
  const SRCSET_ATTRIBUTES = ['srcset', 'data-srcset', 'data-lazy-srcset', 'data-original-srcset'];
  const STYLE_ATTRIBUTES = ['style', 'data-style'];
  const DATA_KEY_HINTS = ['src', 'source', 'url', 'href', 'image', 'video', 'audio', 'poster', 'thumb', 'preview', 'file', 'stream'];
  const META_KEY_HINTS = ['image', 'video', 'audio', 'media', 'thumbnail', 'stream', 'url'];
  const AUTO_SCAN_SELECTORS = [
    'a',
    'img',
    'picture',
    'video',
    'audio',
    'source',
    'track',
    'iframe',
    'object',
    'embed',
    'link[rel]',
    'meta[name]',
    'meta[property]',
    'meta[itemprop]',
    '[style*="url("]',
    '[data-src]',
    '[data-srcset]',
    '[data-original]',
    '[data-url]',
    '[data-href]',
    '[data-bg]',
    '[data-background]',
    '[data-poster]',
    '[data-preview]',
    '[data-thumb]',
    '[data-image]',
    '[data-video]',
    '[data-audio]',
    '[data-file]'
  ].join(',');

  function normalizeUrl(url) {
    if (typeof url !== 'string') {
      return '';
    }
    try {
      const trimmed = url.trim();
      if (!trimmed) {
        return '';
      }
      return new URL(trimmed, document.baseURI).href;
    } catch (error) {
      return url.trim();
    }
  }

  function createLink(url, meta = {}) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return null;
    }
    return {
      url: normalized,
      type: meta.type || 'unknown',
      text: meta.text || '',
      source: meta.source || 'dom',
      filename: meta.filename || ''
    };
  }

  function elementLabel(element) {
    if (!element) {
      return '';
    }
    return (
      element.getAttribute('alt') ||
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent ||
      ''
    ).trim();
  }

  function extractUrlsFromSrcset(value) {
    if (typeof value !== 'string') {
      return [];
    }
    return value
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function extractUrlsFromStyle(value) {
    if (typeof value !== 'string') {
      return [];
    }
    const urls = [];
    const regex = /url\(([^)]+)\)/gi;
    let match;
    while ((match = regex.exec(value)) !== null) {
      const rawUrl = match[1].replace(/[\"']/g, '').trim();
      if (rawUrl && rawUrl !== '#') {
        urls.push(rawUrl);
      }
    }
    return urls;
  }

  function collectFromKnownAttributes(element, fallbackType, label) {
    const results = [];
    const attrs = Array.from(element.attributes || []);
    attrs.forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (!value) {
        return;
      }

      if (SRCSET_ATTRIBUTES.includes(name)) {
        extractUrlsFromSrcset(value).forEach((url) => {
          const link = createLink(url, { type: fallbackType, text: label, source: `attribute:${name}` });
          if (link) {
            results.push(link);
          }
        });
        return;
      }

      if (MEDIA_ATTRIBUTES.includes(name) || name === 'href' || name === 'data-href') {
        const link = createLink(value, { type: fallbackType, text: label, source: `attribute:${name}` });
        if (link) {
          results.push(link);
        }
        return;
      }

      if (STYLE_ATTRIBUTES.includes(name)) {
        extractUrlsFromStyle(value).forEach((url) => {
          const link = createLink(url, { type: 'css-background', text: label, source: `style-attribute:${name}` });
          if (link) {
            results.push(link);
          }
        });
        return;
      }

      if (name.startsWith('data-')) {
        const hint = name.slice(5);
        if (DATA_KEY_HINTS.some((keyword) => hint.includes(keyword))) {
          const link = createLink(value, { type: fallbackType, text: label, source: `data-attribute:${name}` });
          if (link) {
            results.push(link);
          }
        }
      }
    });
    return results;
  }

  function collectFromComputedStyle(element, fallbackType, label) {
    if (!element || typeof window.getComputedStyle !== 'function') {
      return [];
    }
    try {
      const styles = window.getComputedStyle(element);
      const urls = [];
      if (styles.backgroundImage && styles.backgroundImage !== 'none') {
        urls.push(...extractUrlsFromStyle(styles.backgroundImage));
      }
      if (styles.maskImage && styles.maskImage !== 'none') {
        urls.push(...extractUrlsFromStyle(styles.maskImage));
      }
      return urls
        .map((url) =>
          createLink(url, {
            type: fallbackType || 'css-background',
            text: label,
            source: 'computed-style'
          })
        )
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function collectFromAnchor(anchor) {
    const href = anchor.getAttribute('href') || anchor.href;
    if (!href) {
      return [];
    }
    const label = elementLabel(anchor);
    const link = createLink(href, {
      type: 'anchor',
      text: label,
      source: anchor.download ? 'anchor-download' : 'anchor'
    });
    return link ? [link] : [];
  }

  function collectFromLinkElement(linkEl) {
    const results = [];
    const href = linkEl.getAttribute('href') || linkEl.href;
    if (!href) {
      return results;
    }
    const rel = (linkEl.rel || '').toLowerCase();
    const relTokens = rel.split(/\s+/).filter(Boolean);
    const shouldInclude = relTokens.some((token) =>
      ['preload', 'prefetch', 'prerender', 'stylesheet', 'icon', 'apple-touch-icon', 'image', 'video', 'audio'].includes(token)
    );
    if (!shouldInclude && !relTokens.length) {
      return results;
    }
    const label = elementLabel(linkEl);
    const type = linkEl.as || (relTokens[0] || 'link');
    const link = createLink(href, {
      type: type,
      text: label,
      source: `link-rel:${relTokens.join(',') || 'link'}`
    });
    if (link) {
      results.push(link);
    }
    return results;
  }

  function collectFromMetaElement(meta) {
    const content = meta.getAttribute('content');
    if (!content) {
      return [];
    }
    const key = (meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop') || '').toLowerCase();
    if (!key || !META_KEY_HINTS.some((hint) => key.includes(hint))) {
      return [];
    }
    const link = createLink(content, {
      type: `meta:${key}`,
      text: '',
      source: 'meta-tag'
    });
    return link ? [link] : [];
  }

  function collectFromPicture(picture) {
    const results = [];
    picture.querySelectorAll('source, img').forEach((node) => {
      results.push(...collectFromNode(node));
    });
    return results;
  }

  function collectFromNode(node) {
    if (node instanceof Document) {
      return node.documentElement ? collectFromNode(node.documentElement) : [];
    }

    if (!(node instanceof Element)) {
      return [];
    }

    if (node.tagName === 'A') {
      return collectFromAnchor(node);
    }

    if (node.tagName === 'PICTURE') {
      return collectFromPicture(node);
    }

    if (node instanceof HTMLLinkElement) {
      return collectFromLinkElement(node);
    }

    if (node instanceof HTMLMetaElement) {
      return collectFromMetaElement(node);
    }

    const results = [];
    const tag = node.tagName.toLowerCase();
    const label = elementLabel(node);

    if (node instanceof HTMLImageElement || node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
      const currentSrc = node.currentSrc || node.src;
      if (currentSrc) {
        const link = createLink(currentSrc, {
          type: tag,
          text: label,
          source: 'current-src'
        });
        if (link) {
          results.push(link);
        }
      }
    }

    if (node instanceof HTMLVideoElement && node.poster) {
      const posterLink = createLink(node.poster, {
        type: 'poster',
        text: label,
        source: 'poster-attribute'
      });
      if (posterLink) {
        results.push(posterLink);
      }
    }

    if (node instanceof HTMLIFrameElement && node.src) {
      const iframeLink = createLink(node.src, {
        type: 'iframe',
        text: label,
        source: 'iframe'
      });
      if (iframeLink) {
        results.push(iframeLink);
      }
    }

    if (node instanceof HTMLEmbedElement && node.src) {
      const embedLink = createLink(node.src, {
        type: 'embed',
        text: label,
        source: 'embed'
      });
      if (embedLink) {
        results.push(embedLink);
      }
    }

    if (node instanceof HTMLObjectElement && node.data) {
      const objectLink = createLink(node.data, {
        type: 'object',
        text: label,
        source: 'object-data'
      });
      if (objectLink) {
        results.push(objectLink);
      }
    }

    if (node instanceof HTMLSourceElement) {
      const parent = node.parentElement;
      const typeLabel = parent ? parent.tagName.toLowerCase() : tag;
      const src = node.getAttribute('src') || node.src;
      if (src) {
        const link = createLink(src, {
          type: typeLabel,
          text: elementLabel(parent) || label,
          source: 'source-tag'
        });
        if (link) {
          results.push(link);
        }
      }
      const srcset = node.getAttribute('srcset');
      if (srcset) {
        extractUrlsFromSrcset(srcset).forEach((url) => {
          const link = createLink(url, {
            type: typeLabel,
            text: elementLabel(parent) || label,
            source: 'source-srcset'
          });
          if (link) {
            results.push(link);
          }
        });
      }
    }

    if (node instanceof HTMLTrackElement && node.src) {
      const trackLink = createLink(node.src, {
        type: 'track',
        text: label,
        source: 'track'
      });
      if (trackLink) {
        results.push(trackLink);
      }
    }

    results.push(...collectFromKnownAttributes(node, tag, label));
    results.push(...collectFromComputedStyle(node, tag, label));

    return results;
  }

  function flattenLinksFromTree(root) {
    const collected = [];
    if (!root) {
      return collected;
    }

    const processElement = (element) => {
      if (!(element instanceof Element)) {
        return;
      }
      collected.push(...collectFromNode(element));
      element.querySelectorAll(AUTO_SCAN_SELECTORS).forEach((el) => {
        collected.push(...collectFromNode(el));
      });
    };

    if (root instanceof Document) {
      if (root.documentElement) {
        processElement(root.documentElement);
      }
    } else if (root instanceof DocumentFragment) {
      Array.from(root.childNodes || []).forEach((node) => {
        if (node instanceof Element) {
          processElement(node);
        }
      });
    } else if (root instanceof Element) {
      processElement(root);
    }

    return collected;
  }

  function collectFromMediaElement(element) {
    if (!(element instanceof Element)) {
      return [];
    }
    return collectFromNode(element);
  }

  window.mediaLinkHelpers = {
    normalizeUrl,
    collectFromNode,
    flattenLinksFromTree,
    collectFromMediaElement
  };
})();
