(function () {
  const MEDIA_TAGS = new Set(['IMG', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK']);
  const MEDIA_ATTRIBUTES = ['src', 'data-src', 'poster'];

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
      return url;
    }
  }

  function collectFromAttributes(element) {
    const links = [];
    MEDIA_ATTRIBUTES.forEach((attr) => {
      const value = element.getAttribute(attr);
      if (value) {
        const normalized = normalizeUrl(value);
        if (normalized) {
          links.push({
            url: normalized,
            type: element.tagName.toLowerCase(),
            text: element.getAttribute('alt') || element.getAttribute('title') || element.textContent || '',
            source: `attribute:${attr}`
          });
        }
      }
    });
    return links;
  }

  function collectFromAnchor(anchor) {
    const href = anchor.getAttribute('href');
    if (!href) {
      return [];
    }
    const normalized = normalizeUrl(href);
    if (!normalized) {
      return [];
    }
    return [
      {
        url: normalized,
        type: 'anchor',
        text: anchor.textContent || anchor.getAttribute('title') || '',
        source: 'anchor'
      }
    ];
  }

  function collectFromNode(node) {
    if (!(node instanceof Element)) {
      return [];
    }

    if (node.tagName === 'A') {
      return collectFromAnchor(node);
    }

    const results = [];

    if (MEDIA_TAGS.has(node.tagName)) {
      results.push(...collectFromAttributes(node));
    }

    if (node.tagName === 'SOURCE' && node.parentElement && MEDIA_TAGS.has(node.parentElement.tagName)) {
      const src = node.getAttribute('src');
      if (src) {
        const normalized = normalizeUrl(src);
        if (normalized) {
          results.push({
            url: normalized,
            type: node.parentElement.tagName.toLowerCase(),
            text: node.parentElement.getAttribute('title') || node.parentElement.textContent || '',
            source: 'source-tag'
          });
        }
      }
    }

    if (node.hasAttribute && node.hasAttribute('style')) {
      const styleValue = node.getAttribute('style');
      const matches = /url\(([^)]+)\)/gi;
      let match;
      while ((match = matches.exec(styleValue)) !== null) {
        const rawUrl = match[1].replace(/[\"']/g, '').trim();
        const normalized = normalizeUrl(rawUrl);
        if (normalized) {
          results.push({
            url: normalized,
            type: 'css-background',
            text: node.getAttribute('alt') || node.textContent || '',
            source: 'inline-style'
          });
        }
      }
    }

    return results;
  }

  function flattenLinksFromTree(root) {
    const collected = [];
    if (root instanceof Element) {
      collected.push(...collectFromNode(root));
      root.querySelectorAll('a, img, video, audio, source, track, [style]').forEach((el) => {
        collected.push(...collectFromNode(el));
      });
    }
    return collected;
  }

  window.mediaLinkHelpers = {
    normalizeUrl,
    collectFromNode,
    flattenLinksFromTree
  };
})();
