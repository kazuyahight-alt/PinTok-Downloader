'use strict';

const analyzeForm = document.querySelector('#analyzeForm');
const urlInput = document.querySelector('#urlInput');
const analyzeButton = document.querySelector('#analyzeButton');
const serverStatus = document.querySelector('#serverStatus');

const previewSection = document.querySelector('#previewSection');
const previewMedia = document.querySelector('#previewMedia');
const previewPlatform = document.querySelector('#previewPlatform');
const previewStatus = document.querySelector('#previewStatus');
const previewTitle = document.querySelector('#previewTitle');
const previewAuthor = document.querySelector('#previewAuthor');
const previewType = document.querySelector('#previewType');
const previewDuration = document.querySelector('#previewDuration');
const previewMessage = document.querySelector('#previewMessage');
const downloadButton = document.querySelector('#downloadButton');
const copyButton = document.querySelector('#copyButton');

const historyList = document.querySelector('#historyList');
const clearHistoryButton = document.querySelector('#clearHistoryButton');
const toast = document.querySelector('#toast');

const HISTORY_KEY = 'pintok.history.v1';
let currentResult = null;

document.addEventListener('DOMContentLoaded', () => {
  checkServerStatus();
  renderHistory();
});

analyzeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const url = urlInput.value.trim();
  const validation = validateFrontendUrl(url);

  if (!validation.valid) {
    showToast(validation.message, 'error');
    return;
  }

  setLoading(true);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Analyze failed.');
    }

    currentResult = {
      ...result,
      sourceUrl: url,
      analyzedAt: new Date().toISOString()
    };

    renderPreview(currentResult);
    saveHistory(currentResult);
    renderHistory();
    showToast('Link analyzed successfully.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not analyze this link.', 'error');
  } finally {
    setLoading(false);
  }
});

downloadButton.addEventListener('click', async () => {
  if (!currentResult || !currentResult.downloadable || !currentResult.downloadUrl) {
    showToast('This content is preview-only and has no safe legal download file.', 'error');
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = 'Preparing';

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        platform: currentResult.platform,
        title: currentResult.title,
        downloadUrl: currentResult.downloadUrl
      })
    });

    if (!response.ok) {
      let message = 'Download failed.';

      try {
        const errorBody = await response.json();
        message = errorBody.message || message;
      } catch {
        message = 'Download failed.';
      }

      throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const fileName =
      getFileNameFromContentDisposition(response.headers.get('content-disposition')) ||
      `${sanitizeFileName(currentResult.title || 'pintok-download')}.jpg`;

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);

    showToast('Download started.', 'success');
  } catch (error) {
    showToast(error.message || 'Download failed.', 'error');
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = 'Download';
  }
});

copyButton.addEventListener('click', async () => {
  if (!currentResult) {
    showToast('Analyze a link first.', 'error');
    return;
  }

  const text = [
    `Title: ${currentResult.title || 'Unknown'}`,
    `Platform: ${currentResult.platform || 'Unknown'}`,
    `Author: ${currentResult.author || 'Unknown'}`,
    `Type: ${currentResult.type || 'Unknown'}`,
    `Downloadable: ${currentResult.downloadable ? 'Yes' : 'No'}`,
    `Message: ${currentResult.message || ''}`,
    `Source: ${currentResult.sourceUrl || ''}`
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    showToast('Info copied.', 'success');
  } catch {
    showToast('Clipboard is not available in this browser.', 'error');
  }
});

clearHistoryButton.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast('History cleared.', 'success');
});

function renderPreview(result) {
  previewSection.classList.remove('hidden');

  previewPlatform.textContent = capitalize(result.platform || 'unknown');
  previewStatus.textContent = result.downloadable ? 'Download available' : 'Preview only';
  previewStatus.classList.toggle('chip-muted', !result.downloadable);

  previewTitle.textContent = result.title || 'Untitled content';
  previewAuthor.textContent = result.author || 'Unknown';
  previewType.textContent = capitalize(result.type || 'unknown');
  previewDuration.textContent = result.duration ? String(result.duration) : 'Not available';
  previewMessage.textContent = result.message || 'No additional message.';

  if (result.thumbnail) {
    previewMedia.innerHTML = `
      <img
        src="${escapeHtml(result.thumbnail)}"
        alt="Content thumbnail"
        referrerpolicy="no-referrer"
        loading="lazy"
      />
    `;
  } else {
    previewMedia.innerHTML = `
      <div class="preview-placeholder">
        <img src="/assets/icon.svg" alt="" />
      </div>
    `;
  }

  downloadButton.classList.toggle('hidden', !result.downloadable);

  previewSection.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function saveHistory(item) {
  const history = getHistory();

  const normalizedUrl = item.sourceUrl || '';
  const filtered = history.filter((entry) => entry.sourceUrl !== normalizedUrl);

  filtered.unshift({
    title: item.title || 'Untitled content',
    platform: item.platform || 'unknown',
    type: item.type || 'unknown',
    author: item.author || 'Unknown',
    thumbnail: item.thumbnail || null,
    sourceUrl: item.sourceUrl || '',
    downloadable: Boolean(item.downloadable),
    downloadUrl: item.downloadUrl || null,
    message: item.message || '',
    analyzedAt: item.analyzedAt || new Date().toISOString()
  });

  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 20)));
}

function getHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const history = getHistory();

  if (!history.length) {
    historyList.className = 'history-list empty';
    historyList.innerHTML = '<p>No history yet.</p>';
    return;
  }

  historyList.className = 'history-list';

  historyList.innerHTML = history
    .map((item, index) => {
      const thumbnail = item.thumbnail
        ? `<img src="${escapeHtml(item.thumbnail)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`
        : `<img src="/assets/icon.svg" alt="" />`;

      return `
        <article class="history-item">
          <div class="history-thumb">
            ${thumbnail}
          </div>

          <div>
            <p class="history-title">${escapeHtml(item.title || 'Untitled content')}</p>
            <p class="history-meta">
              ${escapeHtml(capitalize(item.platform || 'unknown'))}
              · ${escapeHtml(capitalize(item.type || 'unknown'))}
              · ${item.downloadable ? 'Downloadable' : 'Preview only'}
            </p>
          </div>

          <button class="history-open" type="button" data-history-index="${index}">
            View
          </button>
        </article>
      `;
    })
    .join('');

  historyList.querySelectorAll('[data-history-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.historyIndex);
      const selected = getHistory()[index];

      if (!selected) return;

      currentResult = selected;
      renderPreview(selected);
      showToast('History item opened.', 'success');
    });
  });
}

function validateFrontendUrl(value) {
  if (!value) {
    return {
      valid: false,
      message: 'Paste a URL first.'
    };
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return {
      valid: false,
      message: 'Invalid URL format.'
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      message: 'Only HTTPS URLs are supported.'
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  const isTikTok = [
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vm.tiktok.com',
    'vt.tiktok.com'
  ].includes(hostname);

  const isPinterest =
    [
      'pinterest.com',
      'www.pinterest.com',
      'id.pinterest.com',
      'pin.it',
      'www.pin.it'
    ].includes(hostname) ||
    hostname.endsWith('.pinterest.com');

  if (!isTikTok && !isPinterest) {
    return {
      valid: false,
      message: 'Only TikTok and Pinterest URLs are supported.'
    };
  }

  return {
    valid: true,
    message: 'OK'
  };
}

async function checkServerStatus() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error('API offline');
    }

    serverStatus.classList.remove('offline');
    serverStatus.classList.add('online');
    serverStatus.querySelector('span:last-child').textContent = 'API Online';
  } catch {
    serverStatus.classList.remove('online');
    serverStatus.classList.add('offline');
    serverStatus.querySelector('span:last-child').textContent = 'API Offline';
  }
}

function setLoading(isLoading) {
  analyzeButton.disabled = isLoading;
  analyzeButton.classList.toggle('loading', isLoading);
  analyzeButton.querySelector('.button-text').textContent = isLoading ? 'Analyzing' : 'Analyze';
}

let toastTimer = null;

function showToast(message, type = 'success') {
  clearTimeout(toastTimer);

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 3600);
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function sanitizeFileName(value) {
  return String(value || 'pintok-download')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '') || 'pintok-download';
}

function getFileNameFromContentDisposition(value) {
  if (!value) return null;

  const match = value.match(/filename="([^"]+)"/i);
  return match ? match[1] : null;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
      }
