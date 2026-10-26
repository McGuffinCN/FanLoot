import json
import re
import shutil
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
USERSCRIPT_PATH = ROOT / 'fanloot.user.js'
DIST_DIR = ROOT / 'dist-extension'
ZIP_PATH = ROOT / 'fanloot-extension.zip'

# Microsoft Edge Partner Center + Chrome Web Store both detect store languages
# from `_locales/*/messages.json`. Without this directory, the package appears
# as English (United States) even when the manifest text is Chinese.
DEFAULT_LOCALE = 'zh_CN'
LOCALES = {
    'zh_CN': {
        'extensionName': 'FanLoot | 全能赞助平台下载器',
        'extensionDescription': '批量下载 Fantia / pixivFANBOX / Patreon / Pawchive 作者投稿中的图片、视频、音频、附件与正文网盘链接；支持日期范围、订阅方案、合集筛选、文件类型筛选与自定义文件名规则。',
        'actionTitle': '打开 FanLoot',
    },
    'en': {
        'extensionName': 'FanLoot | All-in-one Fan Platform Downloader',
        'extensionDescription': 'Batch download unlocked Fantia, Fanbox, Patreon, and Pawchive posts: images, videos, audio, attachments, and cloud links. Filter by date, plan, collection, type; save with custom folders.',
        'actionTitle': 'Open FanLoot',
    },
}


def parse_userscript_meta(source: str) -> dict:
    meta = {
        'name': 'FanLoot | 全能赞助平台下载器',
        'version': '1.5.1',
        'description': '批量下载 Fantia / pixivFANBOX / Patreon / Pawchive 作者投稿中的图片、视频、音频、附件与正文网盘链接。',
    }
    header_match = re.search(r'// ==UserScript==(.*?)// ==/UserScript==', source, re.S)
    if not header_match:
        return meta
    for line in header_match.group(1).splitlines():
        m = re.match(r'^//\s*@(\S+)\s+(.+?)\s*$', line)
        if m:
            key, value = m.group(1), m.group(2)
            if key in meta:
                meta[key] = value
    return meta


BACKGROUND_JS = r'''// FanLoot Chrome Extension Background Service Worker (MV3)
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
'''


RULES_JSON = [
    {
        'id': 1,
        'priority': 1,
        'action': {
            'type': 'modifyHeaders',
            'requestHeaders': [
                {'header': 'Referer', 'operation': 'set', 'value': 'https://www.fanbox.cc/'},
                {'header': 'Origin', 'operation': 'set', 'value': 'https://www.fanbox.cc'},
            ],
        },
        'condition': {
            # Only Fanbox CDN (pixiv.pximg.net). Do NOT use bare pximg.net — that also
            # matches i.pximg.net and breaks pixiv.net illustration pages with 403.
            'requestDomains': ['downloads.fanbox.cc', 'pixiv.pximg.net', 'api.fanbox.cc'],
            'resourceTypes': ['xmlhttprequest', 'image', 'media', 'other', 'main_frame', 'sub_frame'],
        },
    },
    {
        'id': 2,
        'priority': 1,
        'action': {
            'type': 'modifyHeaders',
            'requestHeaders': [
                {'header': 'Referer', 'operation': 'set', 'value': 'https://fantia.jp/'},
            ],
        },
        'condition': {
            'requestDomains': ['c.fantia.jp', 'cc.fantia.jp'],
            'resourceTypes': ['xmlhttprequest', 'image', 'media', 'other', 'main_frame', 'sub_frame'],
        },
    },
]


def generate_icons(icons_dir: Path) -> None:
    icons_dir.mkdir(parents=True, exist_ok=True)
    candidates = [
        ROOT / 'icon.png',
        ROOT / 'icon128.png',
        ROOT / 'local' / 'assets' / 'icon.png',
        ROOT / 'local' / 'assets' / 'icon128.png',
    ]
    src_icon = next((p for p in candidates if p.exists()), None)
    if src_icon is None:
        raise FileNotFoundError('No icon.png / icon128.png found in repo root or local/assets')
    with Image.open(src_icon) as img:
        rgba = img.convert('RGBA')
        for size in (16, 32, 48, 128):
            out = rgba.resize((size, size), Image.Resampling.LANCZOS)
            out.save(icons_dir / f'icon{size}.png', format='PNG', optimize=True)


def write_locales(locales_dir: Path) -> None:
    locales_dir.mkdir(parents=True, exist_ok=True)
    for locale, values in LOCALES.items():
        locale_dir = locales_dir / locale
        locale_dir.mkdir(parents=True, exist_ok=True)
        messages = {
            'extensionName': {
                'message': values['extensionName'],
                'description': 'Extension display name shown in Edge / Chrome stores and browser UI.',
            },
            'extensionDescription': {
                'message': values['extensionDescription'],
                'description': 'Short store / browser description for the extension.',
            },
            'actionTitle': {
                'message': values['actionTitle'],
                'description': 'Toolbar button tooltip when clicking the extension icon.',
            },
        }
        (locale_dir / 'messages.json').write_text(
            json.dumps(messages, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )


def build() -> None:
    source = USERSCRIPT_PATH.read_text(encoding='utf-8')
    meta = parse_userscript_meta(source)

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    generate_icons(DIST_DIR / 'icons')
    write_locales(DIST_DIR / '_locales')

    manifest = {
        'manifest_version': 3,
        'default_locale': DEFAULT_LOCALE,
        'name': '__MSG_extensionName__',
        'version': meta['version'],
        'description': '__MSG_extensionDescription__',
        'icons': {
            '16': 'icons/icon16.png',
            '32': 'icons/icon32.png',
            '48': 'icons/icon48.png',
            '128': 'icons/icon128.png',
        },
        'action': {
            'default_title': '__MSG_actionTitle__',
            'default_icon': {
                '16': 'icons/icon16.png',
                '32': 'icons/icon32.png',
                '48': 'icons/icon48.png',
                '128': 'icons/icon128.png',
            },
        },
        'background': {
            'service_worker': 'background.js',
        },
        'permissions': [
            'downloads',
            'storage',
            'scripting',
            'activeTab',
            'declarativeNetRequestWithHostAccess',
        ],
        'host_permissions': [
            'https://fantia.jp/*',
            'https://*.fantia.jp/*',
            'https://fanbox.cc/*',
            'https://*.fanbox.cc/*',
            'https://pixiv.pximg.net/*',
            'https://www.pixiv.net/fanbox/*',
            'https://patreon.com/*',
            'https://*.patreon.com/*',
            'https://*.patreonusercontent.com/*',
            'https://pawchive.pw/*',
            'https://*.pawchive.pw/*',
            'https://iframely.net/*',
            'https://*.iframely.net/*',
            'https://iframe.ly/*',
            'https://*.iframe.ly/*',
        ],
        'declarative_net_request': {
            'rule_resources': [
                {
                    'id': 'referer_rules',
                    'enabled': True,
                    'path': 'rules.json',
                }
            ]
        },
        'content_scripts': [
            {
                'matches': [
                    'https://fantia.jp/*',
                    'https://www.fanbox.cc/*',
                    'https://*.fanbox.cc/*',
                    'https://www.pixiv.net/fanbox/*',
                    'https://www.patreon.com/*',
                    'https://patreon.com/*',
                    'https://pawchive.pw/*',
                    'https://*.pawchive.pw/*',
                ],
                'js': ['content.js'],
                'run_at': 'document_idle',
                'all_frames': False,
            }
        ],
    }

    (DIST_DIR / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    (DIST_DIR / 'background.js').write_text(BACKGROUND_JS, encoding='utf-8')
    (DIST_DIR / 'rules.json').write_text(
        json.dumps(RULES_JSON, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    # Direct isomorphic copy: fanloot.user.js works unmodified as content.js
    shutil.copyfile(USERSCRIPT_PATH, DIST_DIR / 'content.js')

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(DIST_DIR.rglob('*')):
            if file_path.is_file():
                arcname = file_path.relative_to(DIST_DIR).as_posix()
                zf.write(file_path, arcname)

    # Remove the previous dual-output package name if it still exists.
    legacy_zip = ROOT / 'fanloot-chrome-extension.zip'
    if legacy_zip.exists():
        legacy_zip.unlink()

    print(f'Built extension directory: {DIST_DIR}')
    print(f'Built extension zip: {ZIP_PATH} ({ZIP_PATH.stat().st_size} bytes)')
    print("Default locale: %s; available: %s" % (DEFAULT_LOCALE, ", ".join(sorted(LOCALES))))


if __name__ == '__main__':
    build()
