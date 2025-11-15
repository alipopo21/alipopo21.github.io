(function () {
  const listElement = document.querySelector('.link-list');
  const copyButton = document.querySelector('.copy-selected');
  const downloadButton = document.querySelector('.download-selected');
  const statusElement = document.querySelector('.status-message');
  const refreshButton = document.querySelector('.refresh');
  let cachedLinks = [];

  function setStatus(message, isError = false) {
    statusElement.textContent = message || '';
    statusElement.style.color = isError ? '#dc2626' : 'var(--popup-foreground, #222)';
  }

  function createListItem(link, index) {
    const item = document.createElement('li');
    item.className = 'link-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `link-${index}`;
    checkbox.value = link.url;
    checkbox.dataset.index = String(index);

    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);

    const urlSpan = document.createElement('span');
    urlSpan.className = 'link-url';
    urlSpan.textContent = link.url;

    const meta = document.createElement('span');
    meta.className = 'link-meta';
    const filename = link.filename || '';
    const types = (link.types || []).join(', ');
    const texts = (link.texts || []).filter(Boolean).slice(0, 3);
    const sources = (link.sources || []).filter(Boolean).slice(0, 3);
    meta.textContent = [
      filename && filename !== link.url ? `File: ${filename}` : '',
      types && `Type: ${types}`,
      texts.length && `Text: ${texts.join(' / ')}`,
      sources.length && `Source: ${sources.join(', ')}`
    ]
      .filter(Boolean)
      .join(' • ');

    label.appendChild(urlSpan);
    if (meta.textContent) {
      label.appendChild(meta);
    }

    item.appendChild(checkbox);
    item.appendChild(label);
    return item;
  }

  function getSelectedLinkEntries() {
    return Array.from(listElement.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => {
        const index = Number.parseInt(input.dataset.index, 10);
        if (Number.isNaN(index)) {
          return null;
        }
        return cachedLinks[index] || null;
      })
      .filter(Boolean);
  }

  function updateSelectionState() {
    const hasSelection = listElement.querySelectorAll('input[type="checkbox"]:checked').length > 0;
    copyButton.disabled = !hasSelection;
    downloadButton.disabled = !hasSelection;
  }

  function renderLinks(links) {
    cachedLinks = Array.isArray(links) ? links : [];
    listElement.textContent = '';
    if (!cachedLinks.length) {
      setStatus('No media links detected yet. Interact with the page or refresh.');
      copyButton.disabled = true;
      downloadButton.disabled = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    cachedLinks.forEach((link, index) => {
      const item = createListItem(link, index);
      fragment.appendChild(item);
    });
    listElement.appendChild(fragment);
    setStatus(`${cachedLinks.length} link${cachedLinks.length === 1 ? '' : 's'} available.`);
    updateSelectionState();
  }

  function copySelectedLinks() {
    const selectedEntries = getSelectedLinkEntries();
    if (!selectedEntries.length) {
      return;
    }

    const urls = selectedEntries.map((entry) => entry.url);
    navigator.clipboard
      .writeText(urls.join('\n'))
      .then(() => {
        setStatus(`Copied ${urls.length} link${urls.length === 1 ? '' : 's'} to clipboard.`);
      })
      .catch((error) => {
        console.error('Failed to copy links', error);
        setStatus('Unable to copy links. Please try again.', true);
      });
  }

  function downloadSelectedLinks() {
    const selectedEntries = getSelectedLinkEntries();
    if (!selectedEntries.length) {
      return;
    }

    setStatus('Requesting downloads…');
    downloadButton.disabled = true;

    chrome.runtime.sendMessage({ type: 'download-links', links: selectedEntries }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Download request failed', chrome.runtime.lastError);
        setStatus('Unable to start downloads. Please try again.', true);
        updateSelectionState();
        return;
      }

      const result = response || {};
      if (result.status === 'done') {
        if (result.failed && result.failed.length) {
          setStatus(
            `Started ${result.downloaded || 0} download${result.downloaded === 1 ? '' : 's'}, ${result.failed.length} failed to queue.`,
            true
          );
        } else {
          setStatus(`Started ${result.downloaded || selectedEntries.length} download${selectedEntries.length === 1 ? '' : 's'}.`);
        }
      } else if (result.status === 'no-links') {
        setStatus('No downloadable links were selected.', true);
      } else if (result.status === 'unavailable') {
        setStatus('Download permission is unavailable.', true);
      } else {
        setStatus('Unexpected response while starting downloads.', true);
      }

      updateSelectionState();
    });
  }

  function fetchLinksForTab(tabId) {
    chrome.runtime.sendMessage({ type: 'get-links', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching links', chrome.runtime.lastError);
        setStatus('Unable to retrieve links.', true);
        return;
      }
      const links = (response && response.links) || [];
      renderLinks(links);
    });
  }

  function requestLinks(options = {}) {
    const { rescan = false } = options;
    cachedLinks = [];
    listElement.textContent = '';
    copyButton.disabled = true;
    downloadButton.disabled = true;
    setStatus(rescan ? 'Rescanning page…' : 'Loading links…');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab) {
        setStatus('No active tab detected.', true);
        return;
      }

      const loadLinks = () => fetchLinksForTab(activeTab.id);

      if (rescan) {
        try {
          chrome.tabs.sendMessage(activeTab.id, { type: 'rescan-links' }, () => {
            if (chrome.runtime.lastError) {
              console.debug('Rescan message may have failed', chrome.runtime.lastError);
            }
            loadLinks();
          });
        } catch (error) {
          console.debug('Unable to send rescan message', error);
          loadLinks();
        }
      } else {
        loadLinks();
      }
    });
  }

  listElement.addEventListener('change', (event) => {
    if (event.target && event.target.matches('input[type="checkbox"]')) {
      updateSelectionState();
    }
  });

  copyButton.addEventListener('click', copySelectedLinks);
  downloadButton.addEventListener('click', downloadSelectedLinks);
  refreshButton.addEventListener('click', () => requestLinks({ rescan: true }));

  document.addEventListener('DOMContentLoaded', () => requestLinks());
})();
