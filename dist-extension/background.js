// FanLoot Chrome Extension Background Service Worker (MV3)
'use strict';

const downloadsById = new Map(); // downloadId -> { requestId, tabId }
const requestsById = new Map();  // requestId -> { downloadId, tabId, aborted }
let pollTimer = null;

function sendToTab(tabId, payload) {
  if (tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, payload, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // Ignore closed tabs.
  }
}

function settleDownload(downloadId, ok, error, details) {
  const info = downloadsById.get(downloadId);
  if (!info) return;
  downloadsById.delete(downloadId);
  requestsById.delete(info.requestId);
  if (!downloadsById.size && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  sendToTab(info.tabId, {
    type: 'FANLOOT_DL_DONE',
    requestId: info.requestId,
    ok: !!ok,
    error: error || (ok ? '' : 'not_succeeded'),
    details: details || '',
  });
}

function ensurePolling() {
  if (pollTimer || !downloadsById.size) return;
  pollTimer = setInterval(() => {
    if (!downloadsById.size) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    for (const [downloadId, info] of Array.from(downloadsById.entries())) {
      chrome.downloads.search({ id: downloadId }, (items) => {
        if (chrome.runtime.lastError || !items || !items.length) return;
        const item = items[0];
        if (item.state === 'in_progress') {
          sendToTab(info.tabId, {
            type: 'FANLOOT_DL_PROGRESS',
            requestId: info.requestId,
            loaded: item.bytesReceived > 0 ? item.bytesReceived : 0,
            total: item.totalBytes > 0 ? item.totalBytes : 0,
          });
        } else if (item.state === 'complete') {
          settleDownload(downloadId, true);
        } else if (item.state === 'interrupted') {
          settleDownload(downloadId, false, item.error || 'not_succeeded');
        }
      });
    }
  }, 350);
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta || !downloadsById.has(delta.id)) return;
  const info = downloadsById.get(delta.id);
  if (delta.bytesReceived && info) {
    sendToTab(info.tabId, {
      type: 'FANLOOT_DL_PROGRESS',
      requestId: info.requestId,
      loaded: delta.bytesReceived.current || 0,
      total: 0,
    });
  }
  if (delta.state) {
    if (delta.state.current === 'complete') {
      settleDownload(delta.id, true);
    } else if (delta.state.current === 'interrupted') {
      const errCode = (delta.error && delta.error.current) || 'not_succeeded';
      settleDownload(delta.id, false, errCode);
    }
  }
});

function sanitizeDownloadPath(rawName) {
  const cleaned = String(rawName || 'download')
    .replace(/\\+/g, '/')
    .split('/')
    .map((seg) => seg.trim().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .join('/');
  return cleaned || 'download';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  const tabId = sender && sender.tab ? sender.tab.id : null;

  if (msg.type === 'FANLOOT_XHR') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const headers = Object.assign({}, msg.headers || {});
    fetch(msg.url, {
      method: msg.method || 'GET',
      headers,
      credentials: msg.anonymous ? 'omit' : 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timer);
        const text = await response.text();
        sendResponse({
          ok: response.ok,
          status: response.status,
          text,
        });
      })
      .catch((error) => {
        clearTimeout(timer);
        sendResponse({
          ok: false,
          status: 0,
          error: (error && error.message) || 'network error',
        });
      });
    return true;
  }

  if (msg.type === 'FANLOOT_DOWNLOAD') {
    const requestId = String(msg.requestId || '');
    const filename = sanitizeDownloadPath(msg.name);
    const reqState = { downloadId: null, tabId, aborted: false };
    requestsById.set(requestId, reqState);

    chrome.downloads.download({
      url: msg.url,
      filename,
      saveAs: !!msg.saveAs,
      conflictAction: msg.conflictAction || 'uniquify',
    }, (downloadId) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr || !downloadId) {
        requestsById.delete(requestId);
        sendResponse({
          ok: false,
          error: 'not_succeeded',
          details: (lastErr && lastErr.message) || 'chrome.downloads failed',
        });
        return;
      }
      if (reqState.aborted) {
        requestsById.delete(requestId);
        try {
          chrome.downloads.cancel(downloadId, () => void chrome.runtime.lastError);
        } catch (_) { /* ignore */ }
        sendResponse({ ok: false, error: 'USER_CANCELED' });
        return;
      }
      reqState.downloadId = downloadId;
      downloadsById.set(downloadId, { requestId, tabId });
      ensurePolling();
      sendResponse({ ok: true, downloadId });
    });
    return true;
  }

  if (msg.type === 'FANLOOT_DL_ABORT') {
    const requestId = String(msg.requestId || '');
    const reqState = requestsById.get(requestId);
    if (reqState) {
      reqState.aborted = true;
      if (reqState.downloadId != null) {
        const dlId = reqState.downloadId;
        downloadsById.delete(dlId);
        requestsById.delete(requestId);
        try {
          chrome.downloads.cancel(dlId, () => void chrome.runtime.lastError);
        } catch (_) { /* ignore */ }
      }
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'FANLOOT_OPEN_PANEL' }, async () => {
    if (!chrome.runtime.lastError) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      setTimeout(() => {
        sendToTab(tab.id, { type: 'FANLOOT_OPEN_PANEL' });
      }, 120);
    } catch (_) {
      // Unsupported page (e.g. chrome://)
    }
  });
});
