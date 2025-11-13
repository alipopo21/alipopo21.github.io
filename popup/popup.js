(function () {
  const listElement = document.querySelector('.link-list');
  const copyButton = document.querySelector('.copy-selected');
  const statusElement = document.querySelector('.status-message');
  const refreshButton = document.querySelector('.refresh');

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

    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);

    const urlSpan = document.createElement('span');
    urlSpan.className = 'link-url';
    urlSpan.textContent = link.url;

    const meta = document.createElement('span');
    meta.className = 'link-meta';
    const types = (link.types || []).join(', ');
    const texts = (link.texts || []).filter(Boolean).slice(0, 3);
    const sources = (link.sources || []).filter(Boolean).slice(0, 3);
    meta.textContent = [types && `Type: ${types}`, texts.length && `Text: ${texts.join(' / ')}`, sources.length && `Source: ${sources.join(', ')}`]
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

  function updateCopyButtonState() {
    const hasSelection = listElement.querySelectorAll('input[type="checkbox"]:checked').length > 0;
    copyButton.disabled = !hasSelection;
  }

  function renderLinks(links) {
    listElement.textContent = '';
    if (!links.length) {
      setStatus('No media links detected yet. Interact with the page or refresh.');
      copyButton.disabled = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    links.forEach((link, index) => {
      const item = createListItem(link, index);
      fragment.appendChild(item);
    });
    listElement.appendChild(fragment);
    setStatus(`${links.length} link${links.length === 1 ? '' : 's'} available.`);
    updateCopyButtonState();
  }

  function copySelectedLinks() {
    const selected = Array.from(listElement.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
    if (!selected.length) {
      return;
    }

    navigator.clipboard
      .writeText(selected.join('\n'))
      .then(() => {
        setStatus(`Copied ${selected.length} link${selected.length === 1 ? '' : 's'} to clipboard.`);
      })
      .catch((error) => {
        console.error('Failed to copy links', error);
        setStatus('Unable to copy links. Please try again.', true);
      });
  }

  function requestLinks() {
    setStatus('Loading links…');
    copyButton.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab) {
        setStatus('No active tab detected.', true);
        return;
      }
      chrome.runtime.sendMessage({ type: 'get-links', tabId: activeTab.id }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error fetching links', chrome.runtime.lastError);
          setStatus('Unable to retrieve links.', true);
          return;
        }
        const links = (response && response.links) || [];
        renderLinks(links);
      });
    });
  }

  listElement.addEventListener('change', (event) => {
    if (event.target && event.target.matches('input[type="checkbox"]')) {
      updateCopyButtonState();
    }
  });

  copyButton.addEventListener('click', copySelectedLinks);
  refreshButton.addEventListener('click', requestLinks);

  document.addEventListener('DOMContentLoaded', requestLinks);
})();
