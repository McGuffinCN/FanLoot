// ==UserScript==
// @name         FanLoot | 全能赞助平台下载器
// @namespace    https://guff.in/
// @version      1.4.7
// @description  批量下载 Fantia / pixivFANBOX / Patreon / Pawchive 作者投稿中的图片、视频、音频、附件与正文网盘链接；支持日期范围、订阅方案、合集筛选、文件类型筛选与自定义文件名规则。
// @author       McGuffin
// @match        https://fantia.jp/*
// @match        https://www.fanbox.cc/*
// @match        https://*.fanbox.cc/*
// @match        https://www.pixiv.net/fanbox/*
// @match        https://www.patreon.com/*
// @match        https://patreon.com/*
// @match        https://pawchive.pw/*
// @match        https://*.pawchive.pw/*
// @icon         https://files.seeusercontent.com/2026/10/24/1Tmq/icon128.png
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      fantia.jp
// @connect      c.fantia.jp
// @connect      cc.fantia.jp
// @connect      fanbox.cc
// @connect      www.fanbox.cc
// @connect      api.fanbox.cc
// @connect      downloads.fanbox.cc
// @connect      pixiv.pximg.net
// @connect      patreon.com
// @connect      www.patreon.com
// @connect      pawchive.pw
// @connect      *.pawchive.pw
// @connect      iframely.net
// @connect      cdn.iframe.ly
// @connect      iframe.ly
// @connect      *
// @run-at       document-idle
// @noframes
// @license MIT
// ==/UserScript==

(function () {
  'use strict';

  const TEST_HOOK = typeof globalThis !== 'undefined' ? globalThis.__FANTIA_DL_TEST__ : undefined;
  const FANTIA_ORIGIN = 'https://fantia.jp';
  const FANBOX_WWW = 'https://www.fanbox.cc';
  const FANBOX_API = 'https://api.fanbox.cc';
  const PATREON_ORIGIN = 'https://www.patreon.com';
  const PAWCHIVE_ORIGIN = 'https://pawchive.pw';
  const SETTINGS_KEY = 'fantiaDL.settings.v1';
  const HISTORY_KEY = 'fantiaDL.history.v1';
  const FREE_PLAN_KEY = 'free';
  const PATREONS_PLAN_KEY = 'patrons';
  const COLLECTION_NONE_KEY = 'none';
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const CACHE_TTL = 20 * 60 * 1000;

  function detectSite(input) {
    const value = String(input || (typeof location !== 'undefined' ? location.href : '') || '').trim();
    if (!value) return 'fantia';
    if (/pawchive\.pw/i.test(value) || value === 'pawchive') return 'pawchive';
    if (/^(?:https?:[/][/])?(?:www[.])?patreon[.]com(?:[/?#]|$)/i.test(value) || value === 'patreon') return 'patreon';
    if (/fanbox\.cc/i.test(value) || /pixiv\.net\/fanbox/i.test(value)) return 'fanbox';
    if (/fantia\.jp/i.test(value)) return 'fantia';
    return /fanbox/i.test(value) ? 'fanbox' : 'fantia';
  }

  function siteOrigin(site) {
    if (site === 'pawchive') return PAWCHIVE_ORIGIN;
    if (site === 'patreon') return PATREON_ORIGIN;
    return site === 'fanbox' ? FANBOX_WWW : FANTIA_ORIGIN;
  }

  function siteLabel(site) {
    if (site === 'pawchive') return 'Pawchive';
    if (site === 'patreon') return 'Patreon';
    return site === 'fanbox' ? 'Fanbox' : 'Fantia';
  }

    function siteTheme(site) {
    const themes = {
      fantia: {
        accent: '#92d864',
        accentDeep: '#5ea63a',
        accentSoft: '#e9f8dc',
        apricot: '#c7ef9e',
        shadow: '146, 216, 100',
      },
      fanbox: {
        accent: '#0096fa',
        accentDeep: '#006fba',
        accentSoft: '#d9efff',
        apricot: '#63c3ff',
        shadow: '0, 150, 250',
      },
      patreon: {
        accent: '#ff5a00',
        accentDeep: '#d14600',
        accentSoft: '#ffe4d6',
        apricot: '#ff945c',
        shadow: '255, 90, 0',
      },
      pawchive: {
        accent: '#cc9e97',
        accentDeep: '#a87c76',
        accentSoft: '#f4e8e6',
        apricot: '#e0c0ba',
        shadow: '204, 158, 151',
      },
    };
    return themes[site] || themes.fantia;
  }

  function applyTheme(site) {
    if (!ui || !ui.root) return;
    const theme = siteTheme(site || PAGE_SITE);
    const root = ui.root.querySelector('.fdl');
    if (!root) return;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-deep', theme.accentDeep);
    root.style.setProperty('--accent-soft', theme.accentSoft);
    root.style.setProperty('--apricot', theme.apricot);
    root.style.setProperty('--shadow-rgb', theme.shadow);
  }
function defaultTemplateFor(site) {
    if (site === 'pawchive') return 'Pawchive/{user}/{date} {title} ({post_id})/{index}_{name}';
    if (site === 'patreon') return 'Patreon/{user}/{date} {title} ({post_id})/{index}_{name}';
    return site === 'fanbox'
      ? 'Fanbox/{user}/{date} {title} ({post_id})/{index}_{name}'
      : 'Fantia/{user}/{date} {title} ({post_id})/{index}_{name}';
  }

  const PAGE_SITE = detectSite(typeof location !== 'undefined' ? location.href : '');
  const ORIGIN = siteOrigin(PAGE_SITE);

  const TYPE_LABELS = {
    image: '图片',
    video: '视频',
    audio: '音频',
    file: '附件',
    cover: '封面',
    text: '正文',
    link: '链接',
  };
  const TYPE_ORDER = ['image', 'video', 'audio', 'file', 'link', 'cover', 'text'];
  const EXT_GROUPS = {
    image: ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'],
    video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg', '3gp'],
    audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'alac'],
  };

  const VARIABLES = [
    ['{user}', '作者名称'],
    ['{date}', '投稿日期'],
    ['{title}', '投稿标题'],
    ['{post_id}', '投稿 ID'],
    ['{index}', '投稿内序号'],
    ['{name}', '原文件名'],
    ['{plan}', '订阅方案'],
    ['{price}', '方案月费'],
    ['{type}', '文件类型'],
    ['{fanclub}', '粉丝团名称'],
    ['{fanclub_id}', '粉丝团 ID'],
    ['{year}', '年'],
    ['{month}', '月'],
    ['{day}', '日'],
    ['{time}', '时间 HH-mm'],
    ['{content_title}', '内容区块标题'],
    ['{content_id}', '内容区块 ID'],
    ['{page}', '区块内序号'],
    ['{tags}', '标签'],
    ['{ext}', '扩展名'],
  ];

  const DEFAULT_SETTINGS = {
    target: '',
    targetsBySite: { fantia: '', fanbox: '', patreon: '', pawchive: '' },
    scope: 'fanclub',
    dateFrom: '',
    dateTo: '',
    keyword: '',
    excludeKeyword: '',
    types: { image: true, video: true, audio: true, file: true, cover: false, text: false, link: true },
    excludedPlans: [],
    excludedCollections: [],
    template: 'Fantia/{user}/{date} {title} ({post_id})/{index}_{name}',
    dateFormat: 'YYYY-MM-DD',
    concurrency: 3,
    requestDelay: 600,
    skipDownloaded: true,
  };

  // ---------- Generic helpers ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pad = (value, length = 2) => String(value).padStart(length, '0');

  function sleepAbortable(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* storage is best-effort */ }
  }

  function loadSettings() {
    const saved = gmGet(SETTINGS_KEY, {}) || {};
    const targetsBySite = {
      fantia: '',
      fanbox: '',
      patreon: '',
      pawchive: '',
      ...((saved && saved.targetsBySite) || {}),
    };
    const migratedTarget = String((saved && saved.target) || '').trim();
    if (migratedTarget) {
      const migratedSite = detectSite(migratedTarget);
      if (!targetsBySite[migratedSite]) targetsBySite[migratedSite] = migratedTarget;
    }
    const pageTarget = targetsBySite[PAGE_SITE] || (detectSite(migratedTarget) === PAGE_SITE ? migratedTarget : '');
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      types: { ...DEFAULT_SETTINGS.types, ...(saved.types || {}) },
      excludedPlans: Array.isArray(saved.excludedPlans) ? saved.excludedPlans.map(String) : [],
      excludedCollections: Array.isArray(saved.excludedCollections) ? saved.excludedCollections.map(String) : [],
      targetsBySite,
      target: pageTarget,
    };
  }

  function maybePreferSiteTemplate(site) {
    const current = String(settings.template || '').trim();
    const fantiaDefault = defaultTemplateFor('fantia');
    const fanboxDefault = defaultTemplateFor('fanbox');
    const patreonDefault = defaultTemplateFor('patreon');
    const pawchiveDefault = defaultTemplateFor('pawchive');
    if (!current || current === fantiaDefault || current === fanboxDefault || current === patreonDefault || current === pawchiveDefault) {
      const next = defaultTemplateFor(site);
      if (current !== next) {
        settings.template = next;
        saveSettings();
        if (ui) ui.$('fdl-template').value = settings.template;
        schedulePreview();
      }
    }
  }

  function absUrl(url, base = ORIGIN) {
    if (!url) return '';
    try {
      return new URL(url, base).href;
    } catch (_) {
      return '';
    }
  }

  function fileNameFromUrl(url, base = ORIGIN) {
    if (!url) return '';
    try {
      const path = new URL(url, base).pathname;
      return decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    } catch (_) {
      return '';
    }
  }

  function extFromName(name) {
    const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function extFromUrl(url) {
    return extFromName(fileNameFromUrl(url));
  }

  function baseName(name) {
    return String(name || '').replace(/\.[a-z0-9]{1,8}$/i, '');
  }

  function cleanCdnName(name) {
    return baseName(name).replace(/^(?:main|large|medium|thumb|micro|ogp)_(?:webp_)?/i, '');
  }

  function classifyExt(ext) {
    const value = String(ext || '').toLowerCase();
    if (EXT_GROUPS.image.includes(value)) return 'image';
    if (EXT_GROUPS.video.includes(value)) return 'video';
    if (EXT_GROUPS.audio.includes(value)) return 'audio';
    return 'file';
  }

  function parseDate(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function jstParts(ms) {
    const d = new Date(ms + JST_OFFSET);
    return {
      Y: d.getUTCFullYear(),
      M: d.getUTCMonth() + 1,
      D: d.getUTCDate(),
      h: d.getUTCHours(),
      m: d.getUTCMinutes(),
      s: d.getUTCSeconds(),
    };
  }

  function formatDate(ms, pattern = 'YYYY-MM-DD') {
    if (ms == null) return '';
    const p = jstParts(ms);
    const tokens = {
      YYYY: String(p.Y),
      YY: String(p.Y).slice(-2),
      MM: pad(p.M),
      DD: pad(p.D),
      HH: pad(p.h),
      mm: pad(p.m),
      ss: pad(p.s),
    };
    return String(pattern || 'YYYY-MM-DD').replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (token) => tokens[token]);
  }

  function dateInputToMs(value, endOfDay) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const time = endOfDay ? [23, 59, 59, 999] : [0, 0, 0, 0];
    return Date.UTC(y, m - 1, d, ...time) - JST_OFFSET;
  }

  function listDateToMs(value) {
    const match = String(value || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!match) return null;
    const [, y, m, d, h = 0, min = 0] = match.map((part) => (part == null ? part : Number(part)));
    return Date.UTC(y, m - 1, d, h || 0, min || 0) - JST_OFFSET;
  }

  function splitWords(value) {
    return String(value || '')
      .split(/[\s,，、]+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
  }

  function truncateChars(value, max) {
    const chars = Array.from(String(value ?? ''));
    return chars.length > max ? chars.slice(0, max).join('').trim() : chars.join('');
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** i).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
  }

  // ---------- File naming ----------

  const ILLEGAL_MAP = {
    '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜',
  };

  function sanitizeSegment(input, max = 120) {
    let value = String(input ?? '')
      .replace(/[\\/:*?"<>|]/g, (c) => ILLEGAL_MAP[c])
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');
    value = truncateChars(value, max).replace(/[.\s]+$/g, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(value)) value = `_${value}`;
    return value;
  }

  function buildVars(item, settings) {
    const meta = item.post;
    const ms = meta.postedMs;
    const parts = ms == null ? null : jstParts(ms);
    const postLevel = item.kind === 'cover' || item.kind === 'text' || item.kind === 'link';
    return {
      user: meta.user || 'unknown',
      fanclub: meta.fanclub || '',
      fanclub_id: meta.fanclubId || '',
      post_id: meta.id,
      title: truncateChars(meta.title || 'untitled', 80),
      tags: meta.tags || '',
      date: ms == null ? 'unknown-date' : formatDate(ms, settings.dateFormat || DEFAULT_SETTINGS.dateFormat),
      year: parts ? String(parts.Y) : '',
      month: parts ? pad(parts.M) : '',
      day: parts ? pad(parts.D) : '',
      time: parts ? `${pad(parts.h)}-${pad(parts.m)}` : '',
      plan: item.plan ? item.plan.name : (postLevel ? '' : (item.post && item.post.site === 'fanbox' ? '公开' : '公开')),
      price: item.plan ? item.plan.price : 0,
      content_id: item.contentId || '',
      content_title: item.contentTitle || '',
      index: pad(item.index || 0, 3),
      page: pad(item.page || 1, 2),
      name: item.name || 'file',
      ext: item.ext || '',
      type: TYPE_LABELS[item.kind] || item.kind,
    };
  }

  function buildPath(item, settings) {
    const template = String(settings.template || '').trim() || DEFAULT_SETTINGS.template;
    const vars = buildVars(item, settings);
    const rendered = template.replace(/\{([a-z_]+)\}/gi, (whole, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? sanitizeSegment(vars[key]) : whole
    ));
    const segments = rendered.split(/[\\/]+/).map((segment) => sanitizeSegment(segment)).filter(Boolean);
    if (!segments.length) segments.push(sanitizeSegment(item.name) || 'file');
    let path = segments.join('/');
    if (!/\{ext\}/i.test(template) && item.ext) path += `.${item.ext}`;
    return path;
  }

  // ---------- Shared / Fantia / Fanbox parsing ----------

  function normalizePlan(plan) {
    if (!plan || plan.id == null) return null;
    return {
      id: String(plan.id),
      name: plan.name || `方案 ${plan.id}`,
      price: plan.price ?? plan.fee ?? '',
    };
  }

  function feePlan(feeRequired) {
    const fee = Number(feeRequired) || 0;
    if (fee <= 0) return null;
    return {
      id: `fee:${fee}`,
      name: `${fee.toLocaleString()}円以上`,
      price: fee,
    };
  }

  function parseTarget(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    if (/pawchive\.pw/i.test(value) || /^\/(?:fanbox|patreon|fantia)\/user\//i.test(value)) {
      const paw = parsePawchiveTarget(value);
      if (paw) return paw;
    }
    if (/^(?:https?:[/][/])?(?:www[.])?patreon[.]com(?:[/?#]|$)/i.test(value)) return parsePatreonTarget(value);

    let match = value.match(/^(?:https?:\/\/)?([a-z0-9_-]+)\.fanbox\.cc(?:\/|$)/i);
    if (match && !['www', 'api', 'downloads'].includes(match[1].toLowerCase())) {
      const creatorId = match[1];
      const post = value.match(/\/posts\/(\d+)/i);
      return post
        ? { site: 'fanbox', creatorId, postId: post[1] }
        : { site: 'fanbox', creatorId };
    }

    match = value.match(/(?:www\.)?fanbox\.cc\/@([a-z0-9_-]+)/i) || value.match(/pixiv\.net\/fanbox\/creator\/\d+.*?creatorId=([a-z0-9_-]+)/i);
    if (match) {
      const creatorId = match[1];
      const post = value.match(/\/posts\/(\d+)/i);
      return post
        ? { site: 'fanbox', creatorId, postId: post[1] }
        : { site: 'fanbox', creatorId };
    }

    match = value.match(/(?:www\.)?fanbox\.cc\/posts\/(\d+)/i);
    if (match) return { site: 'fanbox', postId: match[1] };

    if (/fanbox/i.test(value)) {
      match = value.match(/posts\/(\d+)/i);
      if (match) return { site: 'fanbox', postId: match[1] };
      match = value.match(/@([a-z0-9_-]+)/i);
      if (match) return { site: 'fanbox', creatorId: match[1] };
    }

    match = value.match(/fanclubs\/(\d+)/i);
    if (match) return { site: 'fantia', fanclubId: match[1] };
    match = value.match(/(?:fantia\.jp\/)?posts\/(\d+)/i);
    if (match && !/fanbox/i.test(value)) return { site: 'fantia', postId: match[1] };
    if (/^\d+$/.test(value)) return { site: 'fantia', fanclubId: value };
    return null;
  }

  function parsePawchiveTarget(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    let url;
    try {
      url = new URL(value, PAWCHIVE_ORIGIN);
    } catch (_) {
      return null;
    }
    if (!/pawchive\.pw$/i.test(url.hostname) && !/^\/(?:fanbox|patreon|fantia)\/user\//i.test(value)) {
      // Allow relative /service/user/... paths when already on Pawchive.
      if (!/pawchive\.pw/i.test(String(input || ''))) return null;
    }
    const match = url.pathname.match(/^\/(fanbox|patreon|fantia)\/user\/([^/?#]+)(?:\/post\/(\d+))?/i);
    if (!match) return null;
    const service = match[1].toLowerCase();
    const userId = decodeURIComponent(match[2]);
    const postId = match[3] || '';
    const out = {
      site: 'pawchive',
      service,
      userId,
      creatorId: `${service}:${userId}`,
    };
    if (postId) out.postId = postId;
    return out;
  }

  function pawchivePostUrl(service, userId, postId) {
    return `${PAWCHIVE_ORIGIN}/${service}/user/${userId}/post/${postId}`;
  }

  function pawchiveUserUrl(service, userId, offset) {
    const base = `${PAWCHIVE_ORIGIN}/${service}/user/${userId}`;
    return offset ? `${base}?o=${offset}` : base;
  }

  function pawchiveOwnerKey(service, userId) {
    return `${service}:${userId}`;
  }

  function splitPawchiveOwner(ownerId) {
    const value = String(ownerId || '');
    const idx = value.indexOf(':');
    if (idx <= 0) return null;
    return {
      service: value.slice(0, idx).toLowerCase(),
      userId: value.slice(idx + 1),
    };
  }

  function pawchiveNameFromDownload(url, downloadAttr) {
    const fromAttr = decodeHtmlEntities(String(downloadAttr || '').trim());
    if (fromAttr) return cleanCdnName(fromAttr) || fromAttr;
    try {
      const parsed = new URL(url, PAWCHIVE_ORIGIN);
      const q = parsed.searchParams.get('f');
      if (q) return cleanCdnName(decodeURIComponent(q)) || decodeURIComponent(q);
    } catch (_) { /* ignore */ }
    return cleanCdnName(fileNameFromUrl(url, PAWCHIVE_ORIGIN)) || 'file';
  }

  function pawchiveTitleFromNode(node) {
    if (!node) return '';
    const spans = Array.from(node.querySelectorAll('span')).map((span) => span.textContent.trim()).filter(Boolean);
    if (spans.length) {
      const cleaned = spans.filter((text) => !/^\((?:Pixiv\s+)?(?:Fanbox|Patreon|Fantia)\)$/i.test(text));
      if (cleaned.length) return cleaned.join(' ').trim();
    }
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parsePawchiveListCards(doc) {
    const cards = [];
    const seen = new Set();
    for (const article of Array.from(doc.querySelectorAll('article.post-card'))) {
      const id = String(article.getAttribute('data-id') || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const service = String(article.getAttribute('data-service') || '').trim().toLowerCase();
      const userId = String(article.getAttribute('data-user') || '').trim();
      const anchor = article.querySelector('a[href*="/post/"]');
      const href = anchor ? absUrl(anchor.getAttribute('href') || '', PAWCHIVE_ORIGIN) : '';
      const titleNode = article.querySelector('.post-card__header');
      const timeNode = article.querySelector('time[datetime], time');
      const publishedMs = parseDate(timeNode && (timeNode.getAttribute('datetime') || timeNode.textContent))
        ?? listDateToMs(timeNode && timeNode.textContent);
      cards.push({
        id,
        title: titleNode ? titleNode.textContent.trim() : '',
        publishedMs,
        updatedMs: publishedMs,
        service,
        userId,
        href,
      });
    }
    return cards;
  }

  function parsePawchiveUserFromDoc(doc, fallback = {}) {
    const header = doc.querySelector('.user-header[data-id], .user-header');
    const service = String((header && header.getAttribute('data-service')) || fallback.service || '').trim().toLowerCase();
    const userId = String((header && header.getAttribute('data-id')) || fallback.userId || '').trim();
    const nameNode = doc.querySelector('.user-header__name [itemprop="name"], .user-header__name, .post__user-name');
    const name = nameNode ? nameNode.textContent.trim() : (fallback.name || userId || '');
    return {
      id: pawchiveOwnerKey(service, userId),
      service,
      userId,
      name,
      user: name,
      site: 'pawchive',
    };
  }

  function extractPawchivePost(doc, hint = {}) {
    const pathMatch = String(hint.url || hint.path || '').match(/\/(fanbox|patreon|fantia)\/user\/([^/?#]+)\/post\/(\d+)/i);
    const article = doc.querySelector('article[data-id], .post[data-id], [data-id][data-service]');
    const service = String(
      hint.service
      || (article && article.getAttribute('data-service'))
      || (pathMatch && pathMatch[1])
      || ''
    ).trim().toLowerCase();
    const userId = String(
      hint.userId
      || (article && article.getAttribute('data-user'))
      || (pathMatch && pathMatch[2])
      || ''
    ).trim();
    const postId = String(
      hint.postId
      || (article && article.getAttribute('data-id'))
      || (pathMatch && pathMatch[3])
      || ''
    ).trim();
    if (!postId) throw new Error('Pawchive 页面缺少投稿 ID');

    const userNode = doc.querySelector('.post__user-name, .user-header__name [itemprop="name"], .user-header__name');
    const userName = (userNode && userNode.textContent.trim()) || hint.user || userId || '';
    const titleNode = doc.querySelector('.post__title');
    const publishedNode = doc.querySelector('.post__published, time[datetime]');
    const publishedText = publishedNode
      ? ((publishedNode.getAttribute && publishedNode.getAttribute('datetime')) || publishedNode.textContent || '')
      : '';
    const postedMs = parseDate(publishedText) ?? listDateToMs(publishedText);
    const meta = {
      id: postId,
      title: pawchiveTitleFromNode(titleNode) || `Post ${postId}`,
      postedMs,
      user: userName,
      fanclub: userName,
      fanclubId: userId,
      tags: '',
      url: hint.url || pawchivePostUrl(service || 'fanbox', userId || 'unknown', postId),
      site: 'pawchive',
      creatorId: pawchiveOwnerKey(service || 'fanbox', userId || ''),
      service: service || '',
      collectionIds: [],
    };
    const entry = createEntry(meta);
    const push = makePusher(entry, meta);
    const textParts = [];
    const base = { contentId: meta.id, contentTitle: '', plan: null };
    entry.plans.push(null);

    const seenData = new Set();
    const pushUnique = (item) => {
      if (!item || !item.url) {
        push(item);
        return;
      }
      let key = String(item.url).toLowerCase();
      try {
        const parsed = new URL(item.url, PAWCHIVE_ORIGIN);
        const match = parsed.pathname.match(/\/data\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{40,}\.[^/?#]+/i);
        key = (match ? match[0] : parsed.pathname).toLowerCase();
      } catch (_) { /* keep raw */ }
      if (seenData.has(key)) return;
      seenData.add(key);
      push(item);
    };

    const sectionMap = new Map();
    for (const heading of Array.from(doc.querySelectorAll('h2'))) {
      const title = String(heading.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!title) continue;
      let node = heading.nextElementSibling;
      while (node && node.tagName && node.tagName.toLowerCase() === 'script') node = node.nextElementSibling;
      sectionMap.set(title, node || heading.parentElement);
    }

    const videosRoot = sectionMap.get('videos') || doc.querySelector('.post__videos');
    if (videosRoot) {
      let page = 0;
      for (const video of Array.from(videosRoot.querySelectorAll('video'))) {
        const source = video.querySelector('source[src]') || video;
        const url = absUrl((source && (source.getAttribute('src') || source.src)) || '', PAWCHIVE_ORIGIN);
        if (!url) continue;
        page += 1;
        const summary = video.closest('li') && video.closest('li').querySelector('summary');
        const name = pawchiveNameFromDownload(url, summary ? summary.textContent : '');
        const ext = extFromName(name) || extFromUrl(url) || 'mp4';
        pushUnique({
          uid: `video:${page}:${name}`,
          kind: classifyExt(ext) === 'audio' ? 'audio' : 'video',
          url,
          ext,
          name: baseName(name) || `video_${page}`,
          plan: null,
          page,
          size: 0,
          contentId: base.contentId,
          contentTitle: base.contentTitle,
        });
      }
    }

    const downloadsRoot = sectionMap.get('downloads') || doc.querySelector('.post__attachments');
    if (downloadsRoot) {
      let page = 0;
      for (const link of Array.from(downloadsRoot.querySelectorAll('a.post__attachment-link, a[download], a[href*="pawchive.pw/data/"]'))) {
        const url = absUrl(link.getAttribute('href') || link.href || '', PAWCHIVE_ORIGIN);
        if (!url || /\/thumbnail\//i.test(url)) continue;
        page += 1;
        const name = pawchiveNameFromDownload(url, link.getAttribute('download') || link.textContent);
        const ext = extFromName(name) || extFromUrl(url) || 'bin';
        const kind = classifyExt(ext);
        pushUnique({
          uid: `download:${page}:${name}`,
          kind: kind === 'image' ? 'file' : kind,
          url,
          ext,
          name: baseName(name) || `file_${page}`,
          plan: null,
          page,
          size: 0,
          contentId: base.contentId,
          contentTitle: base.contentTitle,
        });
      }
    }

    const filesRoot = sectionMap.get('files') || doc.querySelector('.post__files');
    if (filesRoot) {
      let page = 0;
      for (const link of Array.from(filesRoot.querySelectorAll('a.fileThumb, a[download], a[href*="pawchive.pw/data/"]'))) {
        const url = absUrl(link.getAttribute('href') || link.href || '', PAWCHIVE_ORIGIN);
        if (!url || /\/thumbnail\//i.test(url)) continue;
        page += 1;
        const name = pawchiveNameFromDownload(url, link.getAttribute('download') || '');
        const ext = extFromName(name) || extFromUrl(url) || 'jpg';
        const kind = classifyExt(ext);
        pushUnique({
          uid: `file:${page}:${name}`,
          kind: kind === 'file' ? 'image' : kind,
          url,
          ext,
          name: baseName(name) || `image_${page}`,
          plan: null,
          page,
          size: 0,
          contentId: base.contentId,
          contentTitle: base.contentTitle,
        });
      }
    }

    const contentRoot = sectionMap.get('content') || doc.querySelector('.post__content');
    if (contentRoot) {
      textParts.push(String(contentRoot.innerText || contentRoot.textContent || '').trim());
      for (const link of Array.from(contentRoot.querySelectorAll('a[href]'))) {
        const href = decodeHtmlEntities(link.getAttribute('href') || link.href || '');
        if (!href) continue;
        textParts.push(href);
        if (/iframely\.net\//i.test(href)) {
          // Keep raw wrapper for later async resolve; also mark until resolved.
          noteUnresolvedLinkPost(entry, '卡片链接待解析');
        }
      }
      for (const iframe of Array.from(contentRoot.querySelectorAll('iframe[src]'))) {
        const src = decodeHtmlEntities(iframe.getAttribute('src') || '');
        if (src) textParts.push(src);
      }
      // Some pages only keep the wrapper card URL in attributes / raw HTML.
      const rawHtml = String(contentRoot.innerHTML || '');
      for (const url of extractUrlsFromText(rawHtml)) {
        if (/iframely\.net\/|iframe\.ly\//i.test(url)) {
          textParts.push(url);
          noteUnresolvedLinkPost(entry, '卡片链接待解析');
        } else if (looksLikeCloudUrl(url)) {
          textParts.push(url);
        }
      }
    }

    pushTextItem(push, meta, textParts, entry);
    return entry;
  }

  function parsePatreonTarget(input) {
    let url;
    try {
      const value = String(input || '').trim();
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch (_) {
      return null;
    }
    if (!['patreon.com', 'www.patreon.com'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'collection' && /^\d+$/.test(parts[1] || '')) {
      return { site: 'patreon', collectionId: parts[1] };
    }
    if (parts[0] === 'user' && /^\d+$/.test(url.searchParams.get('u') || '')) {
      return { site: 'patreon', userId: url.searchParams.get('u') };
    }
    const postIndex = parts.indexOf('posts');
    if (postIndex >= 0 && parts[postIndex + 1]) {
      const match = parts[postIndex + 1].match(/(?:^|-)(\d+)$/);
      if (match) {
        let creatorId = '';
        if (postIndex > 0) {
          const prev = parts[postIndex - 1];
          if (!['c', 'cw'].includes(String(prev).toLowerCase())) creatorId = prev;
          else if (postIndex > 1) creatorId = parts[postIndex - 2];
        }
        return { site: 'patreon', postId: match[1], ...(creatorId ? { creatorId } : {}) };
      }
      return null;
    }
    let creatorId = '';
    if (['c', 'cw'].includes(String(parts[0] || '').toLowerCase())) creatorId = parts[1] || '';
    else creatorId = parts[0] || '';
    const reserved = new Set(['api', 'home', 'login', 'logout', 'join', 'checkout', 'collection', 'collections', 'user', 'posts', 'settings', 'search', 'notifications', 'messages', 'explore', 'c', 'cw', 'bePatron', 'pledges']);
    if (!creatorId || reserved.has(creatorId.toLowerCase()) || !/^[a-z0-9_.-]+$/i.test(creatorId)) return null;
    const out = { site: 'patreon', creatorId };
    if (parts.includes('collections') || parts.includes('collection')) out.wantsCollections = true;
    return out;
  }

  function patreonResourceIndex(payload) {
    const index = new Map();
    const primary = payload && payload.data;
    const rows = Array.isArray(primary) ? primary : (primary ? [primary] : []);
    const included = (payload && payload.included) || [];
    for (const row of rows.concat(included)) {
      if (!row || row.id == null || !row.type) continue;
      const key = `${row.type}:${row.id}`;
      const previous = index.get(key) || {};
      index.set(key, {
        ...previous,
        ...row,
        attributes: { ...(previous.attributes || {}), ...(row.attributes || {}) },
        relationships: { ...(previous.relationships || {}), ...(row.relationships || {}) },
      });
    }
    return index;
  }

  function patreonRelated(resource, name, index) {
    const data = resource && resource.relationships && resource.relationships[name] && resource.relationships[name].data;
    const refs = Array.isArray(data) ? data : (data ? [data] : []);
    return refs.map((ref) => index.get(`${ref.type}:${ref.id}`) || ref);
  }

  function parsePatreonPage(raw) {
    const source = String(raw || '');
    const chunks = [];
    const pushes = /self\.__next_f\.push\(([\s\S]*?)\)\s*<\/script>/g;
    let match;
    while ((match = pushes.exec(source))) {
      try {
        const payload = JSON.parse(match[1]);
        if (payload[0] === 1 && typeof payload[1] === 'string') chunks.push(payload[1]);
      } catch (_) { /* Ignore non-data script chunks; never execute page scripts. */ }
    }
    const stream = chunks.length ? chunks.join('') : source;
    const textRecords = new Map();
    const textStarts = /(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/gi;
    while ((match = textStarts.exec(stream))) {
      const start = textStarts.lastIndex;
      const expectedBytes = parseInt(match[2], 16);
      let end = start;
      let bytes = 0;
      // Flight text lengths count UTF-8 bytes, not JavaScript characters.
      while (end < stream.length && bytes < expectedBytes) {
        const code = stream.codePointAt(end);
        bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
        end += code > 0xffff ? 2 : 1;
      }
      if (bytes === expectedBytes) {
        textRecords.set(`$${match[1]}`, stream.slice(start, end));
        textStarts.lastIndex = end;
      }
    }
    function resolveTextReferences(value) {
      if (typeof value === 'string') return textRecords.has(value) ? textRecords.get(value) : value;
      if (Array.isArray(value)) return value.map(resolveTextReferences);
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) value[key] = resolveTextReferences(value[key]);
      }
      return value;
    }
    const resources = [];
    const starts = /\{"id":"[^"\n]+","type":"(?:post|campaign|collection|reward|access-rule|media|user|member|pledge|content-unlock-option|free-membership-subscription|launcher-feed-section)"/g;
    while ((match = starts.exec(stream))) {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let i = match.index; i < stream.length; i += 1) {
        const ch = stream[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (ch.charCodeAt(0) === 92) escaped = true;
          else if (ch === '"') quoted = false;
          continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) {
          try {
            const resource = JSON.parse(stream.slice(match.index, i + 1));
            if (resource && resource.type === 'launcher-feed-section' && !resource.attributes) {
              resource.attributes = {
                header: resource.header,
                sectionTypeId: resource.sectionTypeId,
                items: resource.items,
                layout: resource.layout,
                footer: resource.footer,
              };
            }
            if (resource && resource.type === 'collection' && !resource.attributes && (resource.title || resource.post_ids || resource.url)) {
              resource.attributes = resource;
            }
            if (resource.attributes || resource.relationships || resource.type === 'launcher-feed-section') {
              resources.push(resolveTextReferences(resource));
            }
          } catch (_) { /* A truncated Flight record is not a complete resource. */ }
          break;
        }
      }
    }
    return { data: Array.from(patreonResourceIndex({ data: resources }).values()), included: [] };
  }


  function patreonPostUrl(creatorId, postId, attrs) {
    if (attrs && attrs.url) return absUrl(attrs.url, PATREON_ORIGIN);
    if (attrs && attrs.patreon_url) return absUrl(attrs.patreon_url, PATREON_ORIGIN);
    if (creatorId) return `${PATREON_ORIGIN}/${creatorId}/posts/${postId}`;
    return `${PATREON_ORIGIN}/posts/${postId}`;
  }

  function patreonMediaUrl(media) {
    if (!media) return '';
    const attrs = media.attributes || media;
    const imageUrls = attrs.image_urls || {};
    const display = attrs.display || {};
    return attrs.download_url
      || display.url
      || imageUrls.original
      || imageUrls.default
      || imageUrls.url
      || attrs.url
      || '';
  }

  function patreonMediaName(media, fallback) {
    const attrs = (media && media.attributes) || media || {};
    return baseName(attrs.file_name)
      || cleanCdnName(fileNameFromUrl(patreonMediaUrl(media), PATREON_ORIGIN))
      || fallback
      || 'file';
  }

  function patreonMediaExt(media, url) {
    const attrs = (media && media.attributes) || media || {};
    return extFromName(attrs.file_name)
      || extFromUrl(url || patreonMediaUrl(media))
      || 'bin';
  }

  function patreonMediaSize(media) {
    const attrs = (media && media.attributes) || media || {};
    const meta = attrs.metadata || {};
    return Number(attrs.size_bytes || attrs.file_size || meta.size_bytes || meta.file_size || 0) || 0;
  }

  function pushPatreonLinkishAttrs(attrs, textParts) {
    if (!attrs || typeof attrs !== 'object') return;
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value == null) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) textParts.push(text);
        continue;
      }
      if (Array.isArray(value) || (typeof value === 'object')) pushPatreonLinkishAttrs(value, textParts);
    }
  }

  function walkPatreonContent(node, textParts, mediaIds) {
    if (!node) return;
    if (typeof node === 'string') {
      const text = node.trim();
      if (text) textParts.push(text);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => walkPatreonContent(child, textParts, mediaIds));
      return;
    }
    if (typeof node !== 'object') return;
    const type = String(node.type || '').toLowerCase();
    if ((type === 'text' || type === 'hardbreak' || type === 'hard_break') && node.text) {
      const text = String(node.text).trim();
      if (text) textParts.push(text);
    }
    if ((type === 'image' || type === 'audio' || type === 'video' || type === 'file') && node.attrs) {
      const mediaId = node.attrs.media_id || node.attrs.mediaId;
      if (mediaId != null) mediaIds.push(String(mediaId));
      if (node.attrs.src) textParts.push(String(node.attrs.src));
      if (node.attrs.link) textParts.push(String(node.attrs.link));
    }
    // Link / bookmark / preview cards rendered as body “网盘卡片”.
    if (type.includes('link') || type.includes('bookmark') || type.includes('embed') || type.includes('card') || type.includes('cta') || type.includes('preview') || type.includes('button')) {
      pushPatreonLinkishAttrs(node.attrs || {}, textParts);
      if (node.title) textParts.push(String(node.title));
      if (node.description) textParts.push(String(node.description));
      if (node.href) textParts.push(String(node.href));
      if (node.url) textParts.push(String(node.url));
    }
    if (node.attrs && node.attrs.href) textParts.push(String(node.attrs.href));
    if (node.attrs && node.attrs.url) textParts.push(String(node.attrs.url));
    if (node.attrs && node.attrs.link) textParts.push(String(node.attrs.link));
    if (Array.isArray(node.content)) walkPatreonContent(node.content, textParts, mediaIds);
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark && mark.attrs && mark.attrs.href) textParts.push(String(mark.attrs.href));
      }
    }
    // Some card nodes nest the destination URL under arbitrary keys.
    if (type && (type.includes('link') || type.includes('card') || type.includes('embed'))) {
      for (const key of Object.keys(node)) {
        if (key === 'content' || key === 'marks' || key === 'attrs' || key === 'type') continue;
        const value = node[key];
        if (typeof value === 'string' && /https?:\/\//i.test(value)) textParts.push(value);
      }
    }
  }

  function parsePatreonContentJson(raw) {
    const textParts = [];
    const mediaIds = [];
    if (!raw) return { textParts, mediaIds };
    let doc = raw;
    if (typeof raw === 'string') {
      try { doc = JSON.parse(raw); } catch (_) {
        const text = String(raw).trim();
        return { textParts: text ? [text] : [], mediaIds };
      }
    }
    walkPatreonContent(doc, textParts, mediaIds);
    return { textParts, mediaIds };
  }

  function patreonPlanFromAccessRule(rule, index) {
    if (!rule) return null;
    const attrs = rule.attributes || {};
    const type = String(attrs.access_rule_type || attrs.accessRuleType || '').toLowerCase();
    if (type === 'public' || rule.id === 'public') return null;
    const tier = patreonRelated(rule, 'tier', index)[0];
    if (tier && tier.id != null) {
      const tAttrs = tier.attributes || {};
      return normalizePlan({
        id: String(tier.id),
        name: tAttrs.title || tAttrs.name || `Tier ${tier.id}`,
        price: ((Number(tAttrs.amount_cents) || 0) / 100),
      });
    }
    if (type === 'patrons' || type === 'members' || type === 'all_patrons') {
      return normalizePlan({ id: PATREONS_PLAN_KEY, name: '所有付费赞助者', price: '' });
    }
    if (attrs.amount_cents != null) {
      const cents = Number(attrs.amount_cents) || 0;
      return normalizePlan({
        id: `cents:${cents}`,
        name: cents > 0 ? `$${ (cents / 100).toFixed(2) }+` : '赞助内容',
        price: cents / 100,
      });
    }
    if (rule.id != null) {
      return normalizePlan({ id: String(rule.id), name: attrs.title || `规则 ${rule.id}`, price: '' });
    }
    return null;
  }

  function extractPatreonPost(post, indexInput) {
    const index = indexInput || patreonResourceIndex({ data: post, included: [] });
    const attrs = post.attributes || {};
    const campaign = patreonRelated(post, 'campaign', index)[0];
    const campaignAttrs = (campaign && campaign.attributes) || {};
    const user = patreonRelated(post, 'user', index)[0];
    const userAttrs = (user && user.attributes) || {};
    const creatorId = campaignAttrs.vanity
      || campaignAttrs.name
      || userAttrs.vanity
      || '';
    const rules = patreonRelated(post, 'access_rules', index);
    const plans = [];
    const seenPlan = new Set();
    for (const rule of rules) {
      const plan = patreonPlanFromAccessRule(rule, index);
      if (!plan) {
        plans.push(null);
        continue;
      }
      if (seenPlan.has(plan.id)) continue;
      seenPlan.add(plan.id);
      plans.push(plan);
    }
    if (!plans.length) plans.push(null);
    const primaryPlan = plans.find(Boolean) || null;

    const collectionIds = collectionIdsForPost(
      post.id,
      patreonRelated(post, 'collections', index).map((item) => String(item.id)).filter(Boolean),
    );

    const meta = {
      id: String(post.id),
      title: attrs.title || '',
      postedMs: parseDate(attrs.published_at) ?? parseDate(attrs.edited_at) ?? parseDate(attrs.created_at),
      user: campaignAttrs.name || userAttrs.full_name || creatorId || '',
      fanclub: campaignAttrs.name || creatorId || '',
      fanclubId: campaign && campaign.id != null ? String(campaign.id) : '',
      tags: patreonRelated(post, 'user_defined_tags', index)
        .map((tag) => ((tag.attributes || {}).value || (tag.attributes || {}).tag || ''))
        .filter(Boolean)
        .join(' '),
      url: patreonPostUrl(creatorId, post.id, attrs),
      site: 'patreon',
      creatorId: creatorId || (campaign && campaign.id != null ? String(campaign.id) : ''),
      collectionIds,
    };
    const entry = createEntry(meta);
    {
      const uniq = new Map();
      for (const plan of plans) {
        if (!plan) {
          if (!uniq.has(FREE_PLAN_KEY)) uniq.set(FREE_PLAN_KEY, null);
          continue;
        }
        uniq.set(plan.id, plan);
      }
      entry.plans = Array.from(uniq.values());
    }

    const textParts = [];
    const push = makePusher(entry, meta);
    const base = {
      contentId: meta.id,
      contentTitle: '',
      plan: primaryPlan,
    };
    const canView = attrs.current_user_can_view !== false;

    if (!canView) {
      entry.locked.push(base);
      if (attrs.content_teaser_text) textParts.push(String(attrs.content_teaser_text));
      else if (attrs.cleaned_teaser_text) textParts.push(String(attrs.cleaned_teaser_text));
      const thumb = attrs.thumbnail_url
        || (attrs.image && (attrs.image.large_url || attrs.image.url))
        || '';
      if (thumb) {
        push({
          uid: 'cover',
          kind: 'cover',
          url: absUrl(thumb, PATREON_ORIGIN),
          ext: extFromUrl(thumb) || 'jpg',
          name: 'cover',
          plan: null,
          page: 1,
          size: 0,
        });
      }
      pushTextItem(push, meta, textParts, entry);
      return entry;
    }

    const usedMedia = new Set();
    const pushMedia = (media, prefix) => {
      if (!media || media.id == null) return;
      const id = String(media.id);
      if (usedMedia.has(id)) return;
      const url = patreonMediaUrl(media);
      if (!url) return;
      usedMedia.add(id);
      const ext = patreonMediaExt(media, url);
      push({
        ...base,
        uid: `${prefix}-${id}`,
        kind: classifyExt(ext),
        url: absUrl(url, PATREON_ORIGIN),
        ext,
        name: patreonMediaName(media, `${prefix}_${id}`),
        page: usedMedia.size,
        size: patreonMediaSize(media),
      });
    };

    // Attachments first.
    for (const media of patreonRelated(post, 'attachments_media', index)) pushMedia(media, 'attachment');

    // Explicit image / audio / video relations.
    for (const media of patreonRelated(post, 'images', index)) pushMedia(media, 'image');
    for (const media of patreonRelated(post, 'audio', index)) pushMedia(media, 'audio');
    for (const media of patreonRelated(post, 'video', index)) pushMedia(media, 'video');

    // post_file cover/main asset.
    if (attrs.post_file && attrs.post_file.url) {
      const file = attrs.post_file;
      const mediaId = file.media_id != null ? String(file.media_id) : '';
      if (!mediaId || !usedMedia.has(mediaId)) {
        if (mediaId) usedMedia.add(mediaId);
        const url = file.url;
        const ext = extFromUrl(url) || 'bin';
        push({
          ...base,
          uid: `postfile-${mediaId || usedMedia.size + 1}`,
          kind: classifyExt(ext),
          url: absUrl(url, PATREON_ORIGIN),
          ext,
          name: cleanCdnName(fileNameFromUrl(url, PATREON_ORIGIN)) || `postfile_${meta.id}`,
          page: usedMedia.size || 1,
          size: 0,
        });
      }
    }

    const parsedContent = parsePatreonContentJson(attrs.content_json_string || attrs.content);
    for (const mediaId of parsedContent.mediaIds) {
      const media = index.get(`media:${mediaId}`);
      if (media) pushMedia(media, 'content');
    }
    textParts.push(...parsedContent.textParts);

    if (attrs.embed) {
      const embed = attrs.embed;
      const embedBits = [embed.url, embed.provider, embed.subject, embed.description, embed.html]
        .filter(Boolean)
        .map(String);
      textParts.push(...embedBits);
    }
    // Some posts only expose the clickable “网盘卡片” in HTML content / teaser fields.
    for (const raw of [attrs.content, attrs.teaser_text, attrs.content_teaser_text, attrs.cleaned_teaser_text]) {
      if (!raw || typeof raw !== 'string') continue;
      if (/https?:\/\//i.test(raw) || /href=/i.test(raw)) textParts.push(String(raw));
    }

    // Remaining downloadable media relation as fallback.
    for (const media of patreonRelated(post, 'media', index)) {
      const url = patreonMediaUrl(media);
      if (!url) continue;
      // Skip pure thumbnails without download_url when already covered.
      const attrsMedia = media.attributes || {};
      if (!attrsMedia.download_url && usedMedia.has(String(media.id))) continue;
      pushMedia(media, 'media');
    }

    const cover = attrs.meta_image_url
      || attrs.thumbnail_url
      || (attrs.image && (attrs.image.large_url || attrs.image.url))
      || '';
    if (cover) {
      push({
        uid: 'cover',
        kind: 'cover',
        url: absUrl(cover, PATREON_ORIGIN),
        ext: extFromUrl(cover) || 'jpg',
        name: 'cover',
        plan: null,
        page: 1,
        size: 0,
      });
    }

    pushTextItem(push, meta, textParts, entry);
    return entry;
  }

  function targetSite(target, fallbackInput) {
    if (target && target.site) return target.site;
    return detectSite(fallbackInput || settings.target || (typeof location !== 'undefined' ? location.href : ''));
  }

  function deltaToText(comment) {
    try {
      const delta = typeof comment === 'string' ? JSON.parse(comment) : comment;
      return (delta && Array.isArray(delta.ops) ? delta.ops : [])
        .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
        .join('')
        .trim();
    } catch (_) {
      return String(comment || '').trim();
    }
  }

  function fanboxPostUrl(creatorId, postId) {
    if (creatorId) return `${FANBOX_WWW}/@${creatorId}/posts/${postId}`;
    return `${FANBOX_WWW}/posts/${postId}`;
  }

  function createEntry(meta) {
    return {
      meta,
      items: [],
      locked: [],
      streamOnly: [],
      plans: [],
      cloudLinks: [],
      unresolvedLinkPosts: [],
      fetchedAt: Date.now(),
    };
  }

  function makePusher(entry, meta) {
    let index = 0;
    return (item) => {
      if (!item.url && item.kind !== 'text' && item.kind !== 'link') return;
      const postLevel = item.kind === 'cover' || item.kind === 'text' || item.kind === 'link';
      entry.items.push({
        ...item,
        post: meta,
        index: postLevel ? 0 : ++index,
        key: `${meta.id}:${item.uid}`,
      });
    };
  }

  const CLOUD_HOST_HINTS = [
    'pan.baidu.com',
    'yun.baidu.com',
    'baidu.com/s/',
    'mega.nz',
    'mega.co.nz',
    'drive.google.com',
    'docs.google.com',
    'googleapis.com/drive',
    'www.dropbox.com',
    'dropbox.com',
    'dl.dropboxusercontent.com',
    'onedrive.live.com',
    '1drv.ms',
    'sharepoint.com',
    'mediafire.com',
    'workupload.com',
    'pixeldrain.com',
    'gofile.io',
    'anonfiles.com',
    'catbox.moe',
    'litter.catbox.moe',
    'krakenfiles.com',
    'icedrive.net',
    'pcloud.com',
    'box.com',
    'terabox.com',
    '1024tera.com',
    'aliyundrive.com',
    'alipan.com',
    'quark.cn',
    'lanzou',
    '123pan.com',
    '115.com',
    'ctfile.com',
    'cloud.189.cn',
    'iframely.net',
  ];

  function looksLikeCloudUrl(url) {
    const value = String(url || '').toLowerCase();
    if (!/^https?:\/\//i.test(value)) return false;
    // Preview images / static assets from cloud hosts are not share links.
    if (/\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js|map|woff2?|ttf|eot)(?:$|[?#])/i.test(value)) return false;
    if (/\/rich-folder(?:\.png)?(?:$|[?#])/i.test(value)) return false;
    // Wrapper cards are resolved later; still treat them as harvestable link targets.
    if (!CLOUD_HOST_HINTS.some((hint) => value.includes(hint))) return false;
    // MEGA share links should be file/folder/embed (or legacy hash forms), not site assets.
    if (value.includes('mega.nz') || value.includes('mega.co.nz')) {
      return /\/(?:file|folder|embed)\/[\w-]+/i.test(value)
        || /[?#].*!(?:[\w-]+)/i.test(value)
        || /[/#](?:#!|#f!)/i.test(value);
    }
    return true;
  }

  function cloudProviderLabel(url) {
    const value = String(url || '').toLowerCase();
    if (value.includes('iframely.net')) return 'Iframely';
    if (value.includes('baidu.com')) return '百度网盘';
    if (value.includes('mega.nz') || value.includes('mega.co.nz')) return 'MEGA';
    if (value.includes('drive.google.com') || value.includes('docs.google.com') || value.includes('googleapis.com/drive')) return 'Google Drive';
    if (value.includes('dropbox.com') || value.includes('dropboxusercontent.com')) return 'Dropbox';
    if (value.includes('onedrive.live.com') || value.includes('1drv.ms') || value.includes('sharepoint.com')) return 'OneDrive';
    if (value.includes('mediafire.com')) return 'MediaFire';
    if (value.includes('aliyundrive.com') || value.includes('alipan.com')) return '阿里云盘';
    if (value.includes('lanzou')) return '蓝奏云';
    if (value.includes('123pan.com')) return '123云盘';
    if (value.includes('115.com')) return '115网盘';
    if (value.includes('ctfile.com')) return '城通网盘';
    if (value.includes('cloud.189.cn')) return '天翼云盘';
    if (value.includes('terabox.com') || value.includes('1024tera.com')) return 'Terabox';
    if (value.includes('gofile.io')) return 'Gofile';
    if (value.includes('pixeldrain.com')) return 'Pixeldrain';
    try {
      return new URL(url).hostname.replace(/^www\./i, '') || '网盘';
    } catch (_) {
      return '网盘';
    }
  }

  function decodeHtmlEntities(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  function extractUrlsFromText(text) {
    const source = decodeHtmlEntities(text);
    const found = [];
    const seen = new Set();
    const re = /https?:\/\/[^\s<>"'`\]\)}，。；；、】》』」）]+/gi;
    let match;
    while ((match = re.exec(source))) {
      let url = match[0].replace(/[)\],.;:!?，。；：！？]+$/g, '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      found.push(url);
    }
    return found;
  }

  function extractCodeNear(text, url, index) {
    const source = String(text || '');
    const at = index == null ? source.indexOf(url) : index;
    const start = Math.max(0, at - 80);
    const end = Math.min(source.length, at + String(url).length + 120);
    const windowText = source.slice(start, end);
    const patterns = [
      /(?:提取码|密碼|密码|アクセスコード|pass(?:word)?|pwd|code)[:：\s]*([A-Za-z0-9]{3,8})/i,
      /\b(?:pwd|pass)=([A-Za-z0-9]{3,8})\b/i,
    ];
    for (const pattern of patterns) {
      const match = windowText.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  function collectCloudLinks(textParts) {
    const blobs = (Array.isArray(textParts) ? textParts : [textParts])
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    if (!blobs.length) return [];

    const links = [];
    const seen = new Set();
    for (const blob of blobs) {
      for (const url of extractUrlsFromText(blob)) {
        if (!looksLikeCloudUrl(url) || seen.has(url)) continue;
        seen.add(url);
        const idx = blob.indexOf(url);
        links.push({
          url,
          provider: cloudProviderLabel(url),
          code: extractCodeNear(blob, url, idx),
        });
      }
    }
    return links;
  }

  function noteUnresolvedLinkPost(entry, reason) {
    if (!entry || !entry.meta || !entry.meta.url) return;
    const url = String(entry.meta.url);
    if (entry.unresolvedLinkPosts.some((item) => item.url === url)) return;
    entry.unresolvedLinkPosts.push({
      id: entry.meta.id,
      title: entry.meta.title || '',
      url,
      reason: reason || '未能提取链接',
    });
  }

  function recordCloudLinks(entry, textParts) {
    if (!entry) return 0;
    const links = collectCloudLinks(textParts);
    if (!links.length) return 0;
    const seen = new Set(entry.cloudLinks.map((item) => item.url));
    for (const link of links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      entry.cloudLinks.push(link);
    }
    return links.length;
  }

  function pushTextItem(push, meta, textParts, entry) {
    if (entry) recordCloudLinks(entry, textParts);
    if (!textParts.length) return;
    const header = [
      meta.title,
      meta.url,
      `作者：${meta.user}`,
      `投稿日期：${formatDate(meta.postedMs, 'YYYY-MM-DD HH:mm')} JST`,
      meta.tags ? `标签：${meta.tags}` : '',
    ].filter(Boolean).join('\n');
    push({
      uid: 'text',
      kind: 'text',
      url: '',
      text: `${header}\n\n${textParts.join('\n\n')}\n`,
      ext: 'txt',
      name: 'post',
      plan: null,
      page: 1,
      size: 0,
    });
  }

  function buildAggregateLinkItem(entries, settings) {
    const links = [];
    const unresolved = [];
    const seenLink = new Set();
    const seenPost = new Set();

    for (const entry of entries) {
      for (const link of entry.cloudLinks || []) {
        const key = `${entry.meta.id}|${link.url}`;
        if (seenLink.has(key)) continue;
        seenLink.add(key);
        links.push({
          postId: entry.meta.id,
          title: entry.meta.title || '',
          postUrl: entry.meta.url || '',
          provider: link.provider,
          url: link.url,
          code: link.code || '',
        });
      }
      for (const item of entry.unresolvedLinkPosts || []) {
        if (seenPost.has(item.url)) continue;
        seenPost.add(item.url);
        unresolved.push(item);
      }
    }

    if (!links.length && !unresolved.length) return null;

    const lines = ['# FanLoot 链接汇总', ''];
    if (links.length) {
      lines.push(`## 已提取链接（${links.length}）`, '');
      links.forEach((link, index) => {
        lines.push(`${index + 1}. ${link.title || link.postId}`);
        if (link.postUrl) lines.push(`投稿：${link.postUrl}`);
        lines.push(`来源：${link.provider}`);
        lines.push(`链接：${link.url}`);
        if (link.code) lines.push(`提取码：${link.code}`);
        lines.push('');
      });
    } else {
      lines.push('## 已提取链接', '', '（无）', '');
    }

    lines.push(`## 无法提取链接的投稿（${unresolved.length}）`, '');
    const unresolvedSites = new Set(
      (entries || [])
        .filter((entry) => (entry.unresolvedLinkPosts || []).length)
        .map((entry) => entry.meta && entry.meta.site)
        .filter(Boolean),
    );
    lines.push('说明：下列投稿的链接未能完整提取，请打开原帖核对。');
    lines.push('');
    if (unresolved.length) {
      unresolved.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title || item.id}`);
        lines.push(`投稿：${item.url}`);
        lines.push(`原因：${item.reason || '未能提取链接'}`);
        lines.push('');
      });
    } else {
      lines.push('（无）', '');
    }

    const stamp = formatDate(Date.now(), 'YYYYMMDD_HHmm');
    return {
      uid: 'links-aggregate',
      kind: 'link',
      url: '',
      text: `${lines.join('\n')}\n`,
      ext: 'txt',
      name: `FanLoot_links_${stamp}`,
      plan: null,
      page: 1,
      size: 0,
      post: {
        id: 'links',
        title: '链接汇总',
        postedMs: Date.now(),
        user: 'FanLoot',
        fanclub: 'FanLoot',
        fanclubId: '',
        tags: '',
        url: '',
        site: PAGE_SITE,
        creatorId: '',
      },
      index: 0,
      key: `links:aggregate:${stamp}`,
      linkCount: links.length,
      unresolvedCount: unresolved.length,
    };
  }

  function extractFantiaPost(post) {
    const fanclub = post.fanclub || {};
    const meta = {
      id: String(post.id),
      title: post.title || '',
      postedMs: parseDate(post.posted_at) ?? parseDate(post.converted_at),
      user: fanclub.creator_name || (fanclub.user && fanclub.user.name) || fanclub.name || '',
      fanclub: fanclub.name || fanclub.fanclub_name || '',
      fanclubId: fanclub.id == null ? '' : String(fanclub.id),
      tags: (post.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean).join(' '),
      url: `${FANTIA_ORIGIN}/posts/${post.id}`,
      site: 'fantia',
      creatorId: '',
    };
    const entry = createEntry(meta);
    const textParts = [];
    const push = makePusher(entry, meta);

    if (post.comment) textParts.push(String(post.comment).trim());

    for (const content of Array.isArray(post.post_contents) ? post.post_contents : []) {
      const plan = normalizePlan(content.plan);
      const base = {
        contentId: content.id == null ? '' : String(content.id),
        contentTitle: content.title || '',
        plan,
      };
      entry.plans.push(plan);

      if (content.visible_status && content.visible_status !== 'visible') {
        entry.locked.push(base);
        continue;
      }

      const sectionTitle = `${content.title || '无标题'}${plan ? ` [${plan.name}]` : ''}`;
      if (content.category === 'photo_gallery') {
        (content.post_content_photos || []).forEach((photo, i) => {
          const urls = photo.url || {};
          const url = urls.original || urls.main || urls.large || '';
          push({
            ...base,
            uid: `photo-${photo.id ?? `${content.id}-${i}`}`,
            kind: 'image',
            url: absUrl(url, FANTIA_ORIGIN),
            ext: extFromUrl(url, FANTIA_ORIGIN) || 'jpg',
            name: cleanCdnName(fileNameFromUrl(url, FANTIA_ORIGIN)) || `${content.id}_${i + 1}`,
            page: i + 1,
            size: 0,
          });
        });
        if (content.comment) textParts.push(`--- ${sectionTitle} ---\n${content.comment}`);
      } else if (content.category === 'file') {
        if (!content.download_uri) {
          if (content.hls_uri) entry.streamOnly.push(base);
          continue;
        }
        const ext = extFromName(content.filename) || extFromUrl(content.download_uri, FANTIA_ORIGIN) || 'bin';
        push({
          ...base,
          uid: `file-${content.id}`,
          kind: classifyExt(ext),
          url: absUrl(content.download_uri, FANTIA_ORIGIN),
          ext,
          name: baseName(content.filename) || `file_${content.id}`,
          page: 1,
          size: Number(content.file_size) || 0,
        });
        if (content.comment) textParts.push(`--- ${sectionTitle} ---\n${content.comment}`);
      } else if (content.category === 'blog') {
        let delta = null;
        try {
          delta = typeof content.comment === 'string' ? JSON.parse(content.comment) : content.comment;
        } catch (_) { /* old or malformed blog content */ }
        let page = 0;
        for (const op of delta && Array.isArray(delta.ops) ? delta.ops : []) {
          const image = op && op.insert && op.insert.fantiaImage;
          if (!image) continue;
          const url = image.original_url || image.url;
          const extSource = image.url || image.original_url;
          page += 1;
          push({
            ...base,
            uid: `blog-${image.id ?? `${content.id}-${page}`}`,
            kind: 'image',
            url: absUrl(url, FANTIA_ORIGIN),
            ext: extFromUrl(extSource, FANTIA_ORIGIN) || 'jpg',
            name: cleanCdnName(fileNameFromUrl(image.url, FANTIA_ORIGIN)) || `blog_${image.id || page}`,
            page,
            size: 0,
          });
        }
        const text = deltaToText(content.comment);
        if (text) textParts.push(`--- ${sectionTitle} ---\n${text}`);
      } else if (content.comment) {
        textParts.push(`--- ${sectionTitle} ---\n${content.comment}`);
      }
    }

    const thumb = post.thumb && (post.thumb.original || post.thumb.main || post.thumb.large);
    if (thumb) {
      push({
        uid: 'cover',
        kind: 'cover',
        url: absUrl(thumb, FANTIA_ORIGIN),
        ext: extFromUrl(thumb, FANTIA_ORIGIN) || 'jpg',
        name: 'cover',
        plan: null,
        page: 1,
        size: 0,
      });
    }

    pushTextItem(push, meta, textParts, entry);
    return entry;
  }

  function extractFanboxImage(image, base, push, page, prefix) {
    if (!image) return page;
    const url = image.originalUrl || image.url || image.thumbnailUrl || '';
    if (!url) return page;
    const next = page + 1;
    const ext = extFromName(image.extension) || extFromUrl(url) || 'jpg';
    push({
      ...base,
      uid: `${prefix}-${image.id || next}`,
      kind: 'image',
      url: absUrl(url),
      ext,
      name: cleanCdnName(fileNameFromUrl(url)) || `${prefix}_${image.id || next}`,
      page: next,
      size: 0,
    });
    return next;
  }

  function extractFanboxFile(file, base, push, page, prefix) {
    if (!file) return page;
    const url = file.url || file.downloadUrl || '';
    if (!url) return page;
    const next = page + 1;
    const ext = extFromName(file.extension) || extFromName(file.name) || extFromUrl(url) || 'bin';
    push({
      ...base,
      uid: `${prefix}-${file.id || next}`,
      kind: classifyExt(ext),
      url: absUrl(url),
      ext,
      name: baseName(file.name) || cleanCdnName(fileNameFromUrl(url)) || `${prefix}_${file.id || next}`,
      page: next,
      size: Number(file.size) || 0,
    });
    return next;
  }

  function extractFanboxArticle(body, base, push, textParts, entry) {
    if (!body) return;
    const blocks = Array.isArray(body.blocks) ? body.blocks : (Array.isArray(body) ? body : []);
    const imageMap = body.imageMap || {};
    const fileMap = body.fileMap || {};
    const urlEmbedMap = body.urlEmbedMap || {};
    const embedMap = body.embedMap || {};
    let page = 0;
    const lines = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const type = block.type || '';
      if (type === 'p' || type === 'text' || type === 'header') {
        const text = String(block.text || '').trim();
        if (text) lines.push(text);
      } else if (type === 'image') {
        page = extractFanboxImage(imageMap[block.imageId] || block, base, push, page, 'article-image');
      } else if (type === 'file') {
        page = extractFanboxFile(fileMap[block.fileId] || block, base, push, page, 'article-file');
      } else if (type === 'url_embed' || type === 'urlEmbed') {
        const embed = urlEmbedMap[block.urlEmbedId] || block;
        if (embed) {
          const candidates = [
            embed.url,
            embed.host && /^https?:/i.test(embed.host) ? embed.host : '',
            embed.html,
          ].filter(Boolean);
          let added = false;
          const found = [];
          const seen = new Set();
          for (const candidate of candidates) {
            for (const url of extractUrlsFromText(candidate)) {
              const cleaned = decodeHtmlEntities(url).trim();
              if (!cleaned || seen.has(cleaned)) continue;
              seen.add(cleaned);
              found.push(cleaned);
            }
          }
          const clouds = found.filter((url) => looksLikeCloudUrl(url) && !isIframelyUrl(url));
          const wraps = found.filter((url) => isIframelyUrl(url));
          if (clouds.length) {
            lines.push(...clouds);
            added = true;
          } else if (wraps.length) {
            // API often only keeps iframely wrappers; resolve them later / via page DOM.
            lines.push(...wraps);
            noteUnresolvedLinkPost(entry, '卡片链接待解析');
            added = true;
          }
          if (!added) {
            noteUnresolvedLinkPost(entry, '未能提取链接');
            if (embed.host) lines.push(String(embed.host));
          }
        }
      } else if (type === 'embed') {
        const embed = embedMap[block.embedId] || block;
        if (embed) {
          const label = [embed.serviceProvider || embed.provider, embed.id || embed.contentId || ''].filter(Boolean).join(':');
          if (label) {
            entryStreamNote(lines, label);
          }
        }
      }
    }

    if (lines.length) textParts.push(lines.join('\n'));
  }

  function entryStreamNote(lines, label) {
    lines.push(`[外部嵌入] ${label}`);
  }

  function extractFanboxPost(post) {
    const user = post.user || {};
    const creatorId = post.creatorId || '';
    const plan = feePlan(post.feeRequired);
    const meta = {
      id: String(post.id),
      title: post.title || '',
      postedMs: parseDate(post.publishedDatetime) ?? parseDate(post.updatedDatetime),
      user: user.name || creatorId || '',
      fanclub: creatorId || user.name || '',
      fanclubId: creatorId || (user.userId == null ? '' : String(user.userId)),
      tags: (post.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean).join(' '),
      url: fanboxPostUrl(creatorId, post.id),
      site: 'fanbox',
      creatorId,
    };
    const entry = createEntry(meta);
    const textParts = [];
    const push = makePusher(entry, meta);
    const base = {
      contentId: meta.id,
      contentTitle: '',
      plan,
    };
    if (plan) entry.plans.push(plan);
    else entry.plans.push(null);

    if (post.isRestricted) {
      entry.locked.push(base);
      const cover = (post.cover && (post.cover.url || post.cover.originalUrl)) || post.coverImageUrl || '';
      if (cover) {
        push({
          uid: 'cover',
          kind: 'cover',
          url: absUrl(cover),
          ext: extFromUrl(cover) || 'jpg',
          name: 'cover',
          plan: null,
          page: 1,
          size: 0,
        });
      }
      if (post.excerpt) textParts.push(String(post.excerpt));
      pushTextItem(push, meta, textParts, entry);
      return entry;
    }

    const body = post.body || {};
    const type = String(post.type || '').toLowerCase();

    if (type === 'image') {
      let page = 0;
      for (const image of body.images || []) page = extractFanboxImage(image, base, push, page, 'image');
      if (body.text) textParts.push(String(body.text).trim());
    } else if (type === 'file') {
      let page = 0;
      for (const file of body.files || []) page = extractFanboxFile(file, base, push, page, 'file');
      if (body.text) textParts.push(String(body.text).trim());
    } else if (type === 'article') {
      extractFanboxArticle(body, base, push, textParts, entry);
    } else if (type === 'text' || type === 'entry') {
      if (body.text) textParts.push(String(body.text).trim());
      else if (typeof body === 'string') textParts.push(body.trim());
    } else if (type === 'video') {
      if (body && body.video) {
        const video = body.video;
        if (video.url || video.downloadUrl) {
          extractFanboxFile({
            id: video.id || 'video',
            url: video.url || video.downloadUrl,
            name: video.name || video.id || 'video',
            extension: video.extension || extFromUrl(video.url || video.downloadUrl) || 'mp4',
            size: video.size || 0,
          }, base, push, 0, 'video');
        } else {
          entry.streamOnly.push({
            ...base,
            contentTitle: [video.serviceProvider || video.provider, video.videoId || video.id].filter(Boolean).join(' '),
          });
          if (video.serviceProvider || video.provider) {
            textParts.push(`[外部视频] ${video.serviceProvider || video.provider}:${video.videoId || video.id || ''}`);
          }
        }
      }
      // Some "video" posts are actually downloadable files hosted on downloads.fanbox.cc
      for (const file of body.files || []) extractFanboxFile(file, base, push, entry.items.filter((item) => item.kind !== 'cover' && item.kind !== 'text').length, 'video-file');
      if (body.text) textParts.push(String(body.text).trim());
    } else {
      // Unknown / mixed payload: best-effort harvest.
      let page = 0;
      for (const image of body.images || []) page = extractFanboxImage(image, base, push, page, 'image');
      for (const file of body.files || []) page = extractFanboxFile(file, base, push, page, 'file');
      if (body.blocks || body.imageMap || body.fileMap) extractFanboxArticle(body, base, push, textParts, entry);
      if (body.text) textParts.push(String(body.text).trim());
    }

    const cover = (post.cover && (post.cover.url || post.cover.originalUrl)) || post.coverImageUrl || '';
    if (cover) {
      push({
        uid: 'cover',
        kind: 'cover',
        url: absUrl(cover),
        ext: extFromUrl(cover) || 'jpg',
        name: 'cover',
        plan: null,
        page: 1,
        size: 0,
      });
    }

    pushTextItem(push, meta, textParts, entry);
    return entry;
  }

  function extractPost(post, site, index) {
    const resolved = site || (post && post.creatorId ? 'fanbox' : (post && post.type === 'post' ? 'patreon' : 'fantia'));
    if (resolved === 'pawchive') return extractPawchivePost(post, index || {});
    if (resolved === 'fanbox') return extractFanboxPost(post);
    if (resolved === 'patreon') return extractPatreonPost(post, index);
    return extractFantiaPost(post);
  }

  function filterEntries(entries, settings) {
    const ignoreDate = settings.scope === 'post';
    const from = (!ignoreDate && settings.dateFrom) ? dateInputToMs(settings.dateFrom, false) : null;
    const to = (!ignoreDate && settings.dateTo) ? dateInputToMs(settings.dateTo, true) : null;
    const include = splitWords(settings.keyword);
    const exclude = splitWords(settings.excludeKeyword);
    const excludedPlans = new Set((settings.excludedPlans || []).map(String));
    const excludedCollections = new Set((settings.excludedCollections || []).map(String));
    const allowPlan = (plan) => !excludedPlans.has(plan ? plan.id : FREE_PLAN_KEY);
    const allowCollections = (collectionIds) => {
      const ids = Array.isArray(collectionIds) ? collectionIds.map(String) : [];
      if (!ids.length) return !excludedCollections.has(COLLECTION_NONE_KEY);
      return ids.some((id) => !excludedCollections.has(id));
    };
    const result = {
      items: [],
      posts: 0,
      matchedPosts: 0,
      locked: 0,
      streamOnly: 0,
      linkCount: 0,
      unresolvedLinkPosts: 0,
      matchedEntries: [],
    };

    for (const entry of entries) {
      const meta = entry.meta;
      if (!ignoreDate) {
        if (from != null && (meta.postedMs == null || meta.postedMs < from)) continue;
        if (to != null && (meta.postedMs == null || meta.postedMs > to)) continue;
      }
      const haystack = `${meta.title} ${meta.tags}`.toLowerCase();
      if (include.length && !include.some((word) => haystack.includes(word))) continue;
      if (exclude.some((word) => haystack.includes(word))) continue;
      if (entry.plans.length && !entry.plans.some(allowPlan)) continue;
      if (!allowCollections(meta.collectionIds || [])) continue;

      result.matchedPosts += 1;
      result.matchedEntries.push(entry);
      let count = 0;
      for (const item of entry.items) {
        if (item.kind === 'link') continue;
        if (!settings.types[item.kind]) continue;
        if (item.kind !== 'cover' && item.kind !== 'text' && !allowPlan(item.plan)) continue;
        result.items.push(item);
        count += 1;
      }
      result.locked += entry.locked.filter((content) => allowPlan(content.plan)).length;
      result.streamOnly += entry.streamOnly.filter((content) => allowPlan(content.plan)).length;
      if (count) result.posts += 1;
    }

    if (settings.types.link) {
      const aggregate = buildAggregateLinkItem(result.matchedEntries, settings);
      if (aggregate) {
        result.items.push(aggregate);
        result.linkCount = aggregate.linkCount || 0;
        result.unresolvedLinkPosts = aggregate.unresolvedCount || 0;
        if (!result.posts && (result.linkCount || result.unresolvedLinkPosts)) result.posts = 1;
      }
    }

    return result;
  }

  function parsePostCards(doc) {
    const cards = [];
    const anchors = doc.querySelectorAll('.module.post a.link-block[href*="/posts/"], .post a.link-block[href*="/posts/"]');
    for (const anchor of anchors) {
      const match = String(anchor.getAttribute('href') || '').match(/\/posts\/(\d+)/);
      if (!match) continue;
      const card = anchor.closest('.module.post, .post') || anchor.parentElement;
      const dateNode = card && card.querySelector('.post-date .mr-5, .post-date span, .post-date');
      cards.push({
        id: match[1],
        title: (card && card.querySelector('.post-title') && card.querySelector('.post-title').textContent.trim()) || anchor.getAttribute('title') || '',
        updatedMs: listDateToMs(dateNode && dateNode.textContent),
      });
    }
    return cards;
  }

  if (TEST_HOOK) {
    Object.assign(TEST_HOOK, {
      buildPath,
      dateInputToMs,
      extractPost,
      extractPawchivePost,
      filterEntries,
      formatDate,
      listDateToMs,
      parseTarget,
      parsePatreonTarget,
      parsePawchiveTarget,
      parsePawchiveListCards,
      patreonResourceIndex,
      patreonRelated,
      parsePatreonPage,
      detectSite,
      sanitizeSegment,
      collectCloudLinks,
      looksLikeCloudUrl,
      extractCanonicalOrCloudFromHtml,
    });
    return;
  }

  // ---------- Runtime state ----------

  let settings = loadSettings();
  const state = {
    history: new Set(gmGet(HISTORY_KEY, []) || []),
    posts: new Map(),
    order: [],
    plans: new Map(),
    plansFor: '',
    collections: new Map(),
    collectionsFor: '',
    collectionPostMap: new Map(),
    fanclub: null,
    unlockedPlanIds: null,
    planAutoKey: '',
    planAutoTried: '',
    planManual: false,
    collectionManual: false,
    filtered: { items: [], posts: 0, matchedPosts: 0, locked: 0, streamOnly: 0 },
    crawling: false,
    crawlAbort: null,
    csrfToken: '',
    pawPostHints: new Map(),
    dl: null,
  };
  let ui = null;
  let saveTimer = 0;
  let historyTimer = 0;
  let targetTimer = 0;
  let previewTimer = 0;
  let progressFrame = 0;

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => gmSet(SETTINGS_KEY, settings), 250);
  }

  function saveHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => gmSet(HISTORY_KEY, Array.from(state.history)), 500);
  }

  // ---------- Site requests ----------

  function patreonQuery(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item == null || item === '') return;
          search.append(key, String(item));
        });
        return;
      }
      if (typeof value === 'boolean') search.set(key, value ? 'true' : 'false');
      else search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `?${query}` : '';
  }

  function getPatreonCsrf() {
    const match = String(document.cookie || '').match(/(?:^|;\s*)csrftoken=([^;]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function requestPatreon(pathOrUrl, options = {}, attempt = 1) {
    const json = options.json !== false;
    const url = /^https?:/i.test(pathOrUrl)
      ? pathOrUrl
      : `${PATREON_ORIGIN}/${String(pathOrUrl).replace(/^\//, '')}`;
    const headers = {
      Accept: json ? 'application/vnd.api+json, application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (options.method && String(options.method).toUpperCase() !== 'GET') {
      headers['Content-Type'] = 'application/vnd.api+json';
    }
    const csrf = getPatreonCsrf();
    if (csrf) headers['x-csrf-token'] = csrf;
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        headers,
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal && options.signal.aborted) throw error;
      if (attempt < 4) {
        await sleepAbortable(1500 * attempt, options.signal);
        return requestPatreon(pathOrUrl, options, attempt + 1);
      }
      throw error;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      log(`Patreon 请求过快或服务器繁忙（HTTP ${response.status}），${4 * attempt} 秒后重试…`, 'warn');
      await sleepAbortable(4000 * attempt, options.signal);
      return requestPatreon(pathOrUrl, options, attempt + 1);
    }
    if (!response.ok) {
      const label = /^https?:/i.test(pathOrUrl)
        ? pathOrUrl.replace(/^https?:\/\/[^/]+\/?/, '')
        : String(pathOrUrl);
      throw new Error(`HTTP ${response.status} (${label})`);
    }
    return json ? response.json() : response.text();
  }

  function patreonCampaignFromIndex(index) {
    for (const resource of index.values()) {
      if (resource && resource.type === 'campaign') return resource;
    }
    return null;
  }

  function patreonCreatorSlug(campaign, fallback = '') {
    const attrs = (campaign && campaign.attributes) || {};
    const url = String(attrs.url || '');
    const fromUrl = url.match(/patreon\.com\/(?:c(?:w)?\/)?([^/?#]+)/i);
    return attrs.vanity
      || (fromUrl && fromUrl[1] && !['user', 'posts', 'login', 'home'].includes(fromUrl[1].toLowerCase()) ? fromUrl[1] : '')
      || attrs.name
      || fallback
      || '';
  }

  function rememberPatreonCollection(collection) {
    if (!collection || collection.id == null) return null;
    const attrs = collection.attributes || {};
    const id = String(collection.id);
    const postIds = Array.isArray(attrs.post_ids)
      ? attrs.post_ids.map(String)
      : ((state.collections.get(id) && state.collections.get(id).postIds) || []);
    const item = {
      id,
      title: attrs.title || `合集 ${id}`,
      url: attrs.url || `${PATREON_ORIGIN}/collection/${id}`,
      postIds,
      numPosts: Number(attrs.num_posts != null ? attrs.num_posts : postIds.length) || postIds.length,
    };
    state.collections.set(id, item);
    for (const postId of postIds) {
      const key = String(postId);
      const set = state.collectionPostMap.get(key) || new Set();
      set.add(id);
      state.collectionPostMap.set(key, set);
    }
    return item;
  }

  function collectionIdsForPost(postId, extraIds) {
    const ids = new Set((extraIds || []).map(String).filter(Boolean));
    const mapped = state.collectionPostMap.get(String(postId));
    if (mapped) mapped.forEach((id) => ids.add(String(id)));
    return Array.from(ids);
  }

  function attachPatreonCollections(entry) {
    if (!entry || !entry.meta) return entry;
    entry.meta.collectionIds = collectionIdsForPost(entry.meta.id, entry.meta.collectionIds || []);
    return entry;
  }

  const PATREON_POST_INCLUDE = [
    'campaign',
    'access_rules',
    'access_rules.tier.null',
    'attachments_media',
    'audio',
    'audio_preview.null',
    'images',
    'media',
    'user',
    'user_defined_tags',
    'video.null',
    'collections',
    'content_unlock_options.product_variant.null',
    'content_unlock_options.reward.null',
  ].join(',');

  const PATREON_POST_FIELDS = [
    'content_json_string',
    'content',
    'content_teaser_text',
    'cleaned_teaser_text',
    'created_at',
    'edited_at',
    'published_at',
    'current_user_can_view',
    'embed',
    'image',
    'is_paid',
    'meta_image_url',
    'min_cents_pledged_to_view',
    'patreon_url',
    'post_file',
    'post_type',
    'teaser_text_json_string',
    'thumbnail',
    'thumbnail_url',
    'title',
    'url',
    'was_posted_by_campaign_owner',
  ].join(',');

  function buildPatreonPostsUrl(campaignId, cursor) {
    const params = {
      include: PATREON_POST_INCLUDE,
      'fields[campaign]': 'currency,name,url,avatar_photo_url,is_nsfw,patron_count,vanity,creation_name',
      'fields[post]': PATREON_POST_FIELDS,
      'fields[post_tag]': 'tag_type,value',
      'fields[user]': 'image_url,full_name,url,vanity',
      'fields[access_rule]': 'access_rule_type,amount_cents',
      'fields[media]': 'id,image_urls,display,download_url,metadata,file_name,state,size_bytes',
      'fields[reward]': 'amount_cents,title,description,is_free_tier,patron_amount_cents,published',
      'fields[collection]': 'title,url,post_ids,num_posts',
      'filter[campaign_id]': String(campaignId),
      'filter[contains_exclusive_posts]': true,
      'filter[is_draft]': false,
      sort: '-published_at',
      'json-api-use-default-includes': false,
      'json-api-version': '1.0',
    };
    if (cursor) params['page[cursor]'] = cursor;
    return `/api/posts${patreonQuery(params)}`;
  }

  async function fetchPatreonPageResources(pathOrUrl, signal) {
    const html = await requestPatreon(pathOrUrl, { json: false, signal });
    return parsePatreonPage(html);
  }

  async function resolvePatreonCampaign(target, signal) {
    if (!target) throw new Error('缺少 Patreon 目标');
    if (state.fanclub && state.fanclub.site === 'patreon' && state.fanclub.id) {
      const sameCampaign = target.campaignId && String(target.campaignId) === String(state.fanclub.id);
      const sameCreator = target.creatorId && String(target.creatorId) === String(state.fanclub.user || state.fanclub.creatorId || '');
      if (sameCampaign || sameCreator) return state.fanclub;
    }

    const finish = (campaign, extra = {}) => {
      if (!campaign || campaign.id == null) throw new Error('无法识别 Patreon 作者');
      const slug = patreonCreatorSlug(campaign, extra.creatorId || target.creatorId || '');
      const attrs = campaign.attributes || {};
      state.fanclub = {
        id: String(campaign.id),
        name: attrs.name || slug || String(campaign.id),
        user: slug || attrs.name || String(campaign.id),
        creatorId: slug || '',
        site: 'patreon',
        currency: attrs.currency || 'USD',
        ...extra,
      };
      return state.fanclub;
    };

    if (target.campaignId) {
      try {
        const data = await requestPatreon(`/api/campaigns/${target.campaignId}${patreonQuery({
          include: 'creator,rewards',
          'fields[campaign]': 'name,url,vanity,currency,avatar_photo_url,patron_count,is_nsfw,creation_name',
          'fields[reward]': 'amount_cents,title,is_free_tier,patron_amount_cents,published',
          'fields[user]': 'full_name,url,vanity',
          'json-api-version': '1.0',
        })}`, { signal });
        const index = patreonResourceIndex(data);
        registerPatreonRewardsFromIndex(index);
        return finish(data.data, { creatorId: target.creatorId || '' });
      } catch (error) {
        if (signal && signal.aborted) throw error;
        if (state.fanclub && String(state.fanclub.id) === String(target.campaignId)) return state.fanclub;
        throw error;
      }
    }

    if (target.collectionId) {
      try {
        const data = await requestPatreon(`/api/collection/${target.collectionId}${patreonQuery({
          include: 'campaign,cover_media',
          'fields[collection]': 'title,url,post_ids,num_posts,description',
          'fields[campaign]': 'name,url,vanity,currency,avatar_photo_url',
          'json-api-version': '1.0',
        })}`, { signal });
        const index = patreonResourceIndex(data);
        rememberPatreonCollection(data.data);
        const campaign = patreonRelated(data.data, 'campaign', index)[0] || patreonCampaignFromIndex(index);
        if (campaign) return finish(campaign, { collectionId: String(target.collectionId) });
      } catch (error) {
        if (signal && signal.aborted) throw error;
        log(`合集接口读取失败，改解析合集页：${error.message}`, 'warn');
      }
      const page = await fetchPatreonPageResources(`/collection/${target.collectionId}`, signal);
      const index = patreonResourceIndex(page);
      const collection = index.get(`collection:${target.collectionId}`) || Array.from(index.values()).find((row) => row.type === 'collection');
      if (collection) rememberPatreonCollection(collection);
      const campaign = patreonCampaignFromIndex(index);
      return finish(campaign, { collectionId: String(target.collectionId) });
    }

    if (target.postId) {
      const { entry } = await getPostEntry(target.postId, signal, 'patreon');
      if (!entry.meta.fanclubId) throw new Error('无法从投稿中识别 Patreon 作者');
      state.fanclub = {
        id: String(entry.meta.fanclubId),
        name: entry.meta.fanclub || entry.meta.user || entry.meta.creatorId || entry.meta.fanclubId,
        user: entry.meta.creatorId || entry.meta.user || entry.meta.fanclubId,
        creatorId: entry.meta.creatorId || '',
        site: 'patreon',
      };
      return state.fanclub;
    }

    const tryPages = [];
    if (target.userId) tryPages.push(`/user?u=${encodeURIComponent(target.userId)}`);
    if (target.creatorId) {
      tryPages.push(`/${target.creatorId}`);
      tryPages.push(`/cw/${target.creatorId}`);
      tryPages.push(`/c/${target.creatorId}`);
      tryPages.push(`/cw/${target.creatorId}/posts`);
      tryPages.push(`/c/${target.creatorId}/posts`);
    }

    // Prefer JSON API vanity lookup when possible.
    if (target.creatorId) {
      try {
        const data = await requestPatreon(`/api/campaigns${patreonQuery({
          'filter[vanity]': target.creatorId,
          'fields[campaign]': 'name,url,vanity,currency,avatar_photo_url,patron_count,is_nsfw,creation_name',
          'json-api-version': '1.0',
        })}`, { signal });
        const rows = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
        if (rows[0]) return finish(rows[0], { creatorId: target.creatorId });
      } catch (error) {
        if (signal && signal.aborted) throw error;
      }
    }

    let lastError = null;
    for (const pagePath of tryPages) {
      try {
        const page = await fetchPatreonPageResources(pagePath, signal);
        const index = patreonResourceIndex(page);
        const campaign = patreonCampaignFromIndex(index);
        if (campaign) return finish(campaign, { creatorId: target.creatorId || '' });
      } catch (error) {
        if (signal && signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('无法识别 Patreon 作者');
  }

  function extractPatreonCollectionIdsFromHtml(html) {
    const source = String(html || '');
    const ids = new Set();
    const push = (value) => {
      const id = String(value || '').trim();
      if (/^\d+$/.test(id)) ids.add(id);
    };

    const collectByNeedle = (needle) => {
      let from = 0;
      while (true) {
        const at = source.indexOf(needle, from);
        if (at < 0) break;
        const slice = source.slice(at, at + needle.length + 24);
        const digits = slice.slice(needle.length).match(/^(\d{3,})/);
        if (digits) push(digits[1]);
        from = at + needle.length;
      }
    };

    collectByNeedle('/collection/');
    collectByNeedle('collection/');
    collectByNeedle('collection%2F');
    collectByNeedle('collection\u002f');
    collectByNeedle('collection\/');

    let idx = 0;
    while (true) {
      const at = source.indexOf('"type":"collection"', idx);
      if (at < 0) break;
      const slice = source.slice(Math.max(0, at - 120), at + 160);
      const idMatch = slice.match(/"id":"(\d+)"/);
      if (idMatch) push(idMatch[1]);
      idx = at + 18;
    }

    idx = 0;
    while (true) {
      const at = source.indexOf('internal_destination', idx);
      if (at < 0) break;
      const slice = source.slice(at, at + 120);
      const marker = slice.indexOf('collection/');
      if (marker >= 0) {
        const digits = slice.slice(marker + 'collection/'.length).match(/^(\d{3,})/);
        if (digits) push(digits[1]);
      }
      idx = at + 20;
    }

    return Array.from(ids);
  }

  function ingestPatreonLauncherCollections(payload) {
    const rows = Array.isArray(payload && payload.data)
      ? payload.data
      : (payload && payload.data ? [payload.data] : []);
    const extras = (payload && payload.included) || [];
    const found = [];
    for (const row of rows.concat(extras)) {
      if (!row) continue;
      if (row.type === 'collection') {
        // Flight dumps sometimes flatten attributes onto the resource root.
        const normalized = row.attributes ? row : {
          id: row.id,
          type: 'collection',
          attributes: row,
        };
        const item = rememberPatreonCollection(normalized);
        if (item) found.push(item);
        continue;
      }
      if (row.type !== 'launcher-feed-section') continue;
      const attrs = row.attributes || row;
      const header = attrs.header || {};
      const destination = (header.navigation && header.navigation.destination) || {};
      const url = String(destination.url || attrs.url || '');
      const internal = String(destination.internal_destination || attrs.internal_destination || attrs.sectionTypeId || '');
      const match = url.match(/\/collection\/(\d+)/i)
        || internal.match(/(?:^|\/)collection\/(\d+)/i)
        || String(attrs.sectionTypeId || '').match(/collection[_/:-]?(\d+)/i);
      if (!match) continue;
      const id = String(match[1]);
      const subtitle = String(header.subtitle || attrs.subtitle || '');
      const countMatch = subtitle.match(/(\d+)/);
      const title = (typeof header.title === 'string' ? header.title : '')
        || (header.title && header.title.text)
        || attrs.title
        || `合集 ${id}`;
      const item = rememberPatreonCollection({
        id,
        type: 'collection',
        attributes: {
          title,
          url: url || `${PATREON_ORIGIN}/collection/${id}`,
          num_posts: countMatch ? Number(countMatch[1]) : undefined,
          post_ids: (state.collections.get(id) && state.collections.get(id).postIds) || [],
        },
      });
      if (item) found.push(item);
    }
    return found;
  }

  function discoverPatreonCollectionEndpointsFromPerformance(campaignId) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
      const url = String(value || '').trim();
      if (!url || seen.has(url)) return;
      if (!/patreon\.com\/api\//i.test(url)) return;
      if (!/collection/i.test(url)) return;
      seen.add(url);
      out.push(url);
    };
    try {
      const entries = (typeof performance !== 'undefined' && performance.getEntriesByType)
        ? performance.getEntriesByType('resource')
        : [];
      for (const entry of entries) {
        const name = String((entry && entry.name) || '');
        if (!/\/api\/(?:collections?|campaigns\/\d+\/collections?)/i.test(name)) continue;
        if (campaignId && name.includes('campaign_id=') && !name.includes(String(campaignId))) continue;
        push(name);
      }
    } catch (_) { /* ignore */ }
    return out;
  }

  function scrapePatreonCollectionsFromDom() {
    const found = [];
    try {
      if (typeof document === 'undefined') return found;
      for (const a of Array.from(document.querySelectorAll('a[href*="/collection/"]')).slice(0, 200)) {
        const href = String(a.href || a.getAttribute('href') || '');
        const match = href.match(/\/collection\/(\d+)/i);
        if (!match) continue;
        const id = String(match[1]);
        const title = String(a.textContent || '').replace(/\s+/g, ' ').trim() || `合集 ${id}`;
        const item = rememberPatreonCollection({
          id,
          type: 'collection',
          attributes: {
            title,
            url: href.startsWith('http') ? href : `${PATREON_ORIGIN}/collection/${id}`,
            post_ids: (state.collections.get(id) && state.collections.get(id).postIds) || [],
          },
        });
        if (item) found.push(item);
      }
    } catch (_) { /* ignore */ }
    return found;
  }

  async function fetchPatreonCollections(campaignId, signal, creatorSlug) {
    const ownerKey = String(campaignId || '');
    if (state.collectionsFor === ownerKey && state.collections.size) return Array.from(state.collections.values());

    state.collections = new Map();
    state.collectionPostMap = new Map();
    state.collectionsFor = ownerKey;
    renderCollections('正在读取合集…');

    const ingestPayload = (payload) => {
      const rows = Array.isArray(payload && payload.data)
        ? payload.data
        : (payload && payload.data ? [payload.data] : []);
      const extras = (payload && payload.included) || [];
      for (const row of rows.concat(extras)) {
        if (row && row.type === 'collection') rememberPatreonCollection(row);
      }
      ingestPatreonLauncherCollections(payload);
    };

    const hasReadyCollections = () => {
      if (!state.collections.size) return false;
      // Prefer stopping once we have real post membership data.
      return Array.from(state.collections.values()).some((item) => item.postIds && item.postIds.length);
    };

    const collectionFields = 'title,url,post_ids,num_posts,description,created_at,edited_at,thumbnail';
    const discoveredIds = new Set();

    // 1) Free local signals first.
    scrapePatreonCollectionsFromDom();
    for (const id of state.collections.keys()) discoveredIds.add(String(id));

    // 2) Reuse already-seen Network URLs when possible.
    for (const endpoint of discoverPatreonCollectionEndpointsFromPerformance(campaignId)) {
      try {
        const data = await requestPatreon(endpoint, { signal });
        ingestPayload(data);
        for (const id of state.collections.keys()) discoveredIds.add(String(id));
        if (hasReadyCollections()) {
          renderCollections();
          log(`已读取 ${state.collections.size} 个 Patreon 合集`);
          return Array.from(state.collections.values());
        }
      } catch (error) {
        if (signal && signal.aborted) throw error;
      }
    }

    // 3) One primary list API, then stop if it works.
    const primaryEndpoints = [
      `/api/collections${patreonQuery({
        include: 'cover_media',
        'fields[collection]': collectionFields,
        'fields[media]': 'id,image_urls,download_url,file_name,state,size_bytes',
        'filter[campaign_id]': String(campaignId),
        'page[count]': 100,
        sort: '-created_at',
        'json-api-version': '1.0',
        'json-api-use-default-includes': false,
      })}`,
      `/api/campaigns/${campaignId}/collections${patreonQuery({
        include: 'cover_media',
        'fields[collection]': collectionFields,
        'page[count]': 100,
        'json-api-version': '1.0',
        'json-api-use-default-includes': false,
      })}`,
    ];
    for (const endpoint of primaryEndpoints) {
      try {
        const data = await requestPatreon(endpoint, { signal });
        ingestPayload(data);
        for (const id of state.collections.keys()) discoveredIds.add(String(id));
        if (hasReadyCollections()) {
          renderCollections();
          log(`已读取 ${state.collections.size} 个 Patreon 合集`);
          return Array.from(state.collections.values());
        }
        if (state.collections.size) break;
      } catch (error) {
        if (signal && signal.aborted) throw error;
      }
    }

    // 4) Parse only a small set of likely pages, stop early when IDs appear.
    const pageCandidates = [];
    if (typeof location !== 'undefined' && /patreon\.com/i.test(String(location.href || ''))) {
      pageCandidates.push(String(location.pathname || '/') + String(location.search || ''));
    }
    if (creatorSlug) {
      pageCandidates.push(`/cw/${creatorSlug}/collections`);
      pageCandidates.push(`/cw/${creatorSlug}/home`);
      pageCandidates.push(`/cw/${creatorSlug}`);
      pageCandidates.push(`/c/${creatorSlug}/collections`);
      pageCandidates.push(`/${creatorSlug}/collections`);
    }
    for (const pagePath of pageCandidates) {
      try {
        const html = await requestPatreon(pagePath, { json: false, signal });
        for (const id of extractPatreonCollectionIdsFromHtml(html)) discoveredIds.add(String(id));
        ingestPayload(parsePatreonPage(html));
        for (const id of state.collections.keys()) discoveredIds.add(String(id));
        if (state.collections.size) break;
      } catch (error) {
        if (signal && signal.aborted) throw error;
      }
    }

    // 5) Optional launcher-feed once.
    if (!state.collections.size) {
      const launcherEndpoints = [
        `/api/launcher-feed${patreonQuery({
          'filter[campaign_id]': String(campaignId),
          'json-api-version': '1.0',
        })}`,
        `/api/campaigns/${campaignId}/launcher-feed${patreonQuery({ 'json-api-version': '1.0' })}`,
      ];
      for (const endpoint of launcherEndpoints) {
        try {
          const data = await requestPatreon(endpoint, { signal });
          ingestPayload(data);
          for (const id of extractPatreonCollectionIdsFromHtml(JSON.stringify(data))) discoveredIds.add(String(id));
          for (const id of state.collections.keys()) discoveredIds.add(String(id));
          if (state.collections.size) break;
        } catch (error) {
          if (signal && signal.aborted) throw error;
        }
      }
    }

    scrapePatreonCollectionsFromDom();
    for (const id of state.collections.keys()) discoveredIds.add(String(id));

    // 6) Hydrate only collections still missing post_ids, and cap the work.
    const missing = Array.from(discoveredIds).filter((id) => {
      const existing = state.collections.get(id);
      return !(existing && existing.postIds && existing.postIds.length);
    }).slice(0, 20);
    for (const id of missing) {
      try {
        const data = await requestPatreon(`/api/collection/${id}${patreonQuery({
          include: 'campaign,cover_media',
          'fields[collection]': collectionFields,
          'fields[campaign]': 'name,url,vanity',
          'json-api-version': '1.0',
          'json-api-use-default-includes': false,
        })}`, { signal });
        ingestPayload(data);
        await sleepAbortable(Math.max(80, Math.floor(settings.requestDelay / 4)), signal);
      } catch (error) {
        if (signal && signal.aborted) throw error;
      }
    }

    if (!state.collections.size) {
      log('未从接口读到合集。请先打开作者主页或合集页，再点一次刷新目标。', 'warn');
      renderCollections('未找到合集（可打开作者合集页后再试）');
    } else {
      log(`已读取 ${state.collections.size} 个 Patreon 合集`);
      renderCollections();
    }
    return Array.from(state.collections.values());
  }

  async function ensurePatreonCollections(campaignId, signal, preferredCollectionId) {
    if (!campaignId) return;
    const creatorSlug = (state.fanclub && (state.fanclub.creatorId || state.fanclub.user)) || '';
    await fetchPatreonCollections(campaignId, signal, creatorSlug);

    if (preferredCollectionId) {
      const preferred = String(preferredCollectionId);
      if (!state.collectionManual) {
        const allIds = [COLLECTION_NONE_KEY, ...Array.from(state.collections.keys())];
        settings.excludedCollections = allIds.filter((id) => id !== preferred);
        saveSettings();
      }
      if (!state.collections.has(preferred)) {
        try {
          const data = await requestPatreon(`/api/collection/${preferred}`, { signal });
          rememberPatreonCollection(data.data);
        } catch (_) { /* ignore */ }
      }
    }
    renderCollections();
  }

  function registerPatreonRewardsFromIndex(index) {
    let changed = false;
    for (const resource of index.values()) {
      if (!resource || resource.type !== 'reward') continue;
      const attrs = resource.attributes || {};
      if (attrs.is_free_tier || String(resource.id) === '-1') continue;
      const cents = Number(attrs.amount_cents != null ? attrs.amount_cents : attrs.patron_amount_cents) || 0;
      const plan = normalizePlan({
        id: String(resource.id),
        name: attrs.title || attrs.name || `Tier ${resource.id}`,
        price: cents / 100,
      });
      if (plan && !state.plans.has(plan.id)) {
        state.plans.set(plan.id, plan);
        changed = true;
      }
    }
    return changed;
  }

  async function detectPatreonUnlockedPlanIds(campaignId, signal) {
    const unlocked = new Set([FREE_PLAN_KEY]);
    try {
      const data = await requestPatreon(`/api/campaigns/${campaignId}${patreonQuery({
        include: [
          'rewards',
          'current_user_pledge',
          'current_user_pledge.reward',
          'current_user_free_membership_subscription',
          'creator',
        ].join(','),
        'fields[campaign]': 'name,url,vanity,currency,patron_count',
        'fields[reward]': 'amount_cents,title,is_free_tier,patron_amount_cents,published',
        'fields[pledge]': 'amount_cents,currency,status',
        'json-api-version': '1.0',
      })}`, { signal });
      const index = patreonResourceIndex(data);
      registerPatreonRewardsFromIndex(index);
      const campaign = data.data;
      const freeSub = patreonRelated(campaign, 'current_user_free_membership_subscription', index)[0];
      const pledge = patreonRelated(campaign, 'current_user_pledge', index)[0];
      if (freeSub) unlocked.add(FREE_PLAN_KEY);
      if (pledge) {
        unlocked.add(PATREONS_PLAN_KEY);
        const reward = patreonRelated(pledge, 'reward', index)[0];
        const pledgeCents = Number((pledge.attributes || {}).amount_cents) || 0;
        if (reward && reward.id != null) unlocked.add(String(reward.id));
        for (const plan of state.plans.values()) {
          const priceCents = Math.round((Number(plan.price) || 0) * 100);
          if (priceCents > 0 && priceCents <= pledgeCents) unlocked.add(String(plan.id));
        }
      }

      // Fallback: parse creator page membership bootstrap when pledge relation is empty.
      if (!pledge) {
        const slug = patreonCreatorSlug(campaign, state.fanclub && state.fanclub.creatorId);
        if (slug) {
          const page = await fetchPatreonPageResources(`/cw/${slug}`, signal).catch(() => null)
            || await fetchPatreonPageResources(`/c/${slug}`, signal).catch(() => null)
            || await fetchPatreonPageResources(`/${slug}`, signal).catch(() => null);
          if (page) {
            const pageIndex = patreonResourceIndex(page);
            registerPatreonRewardsFromIndex(pageIndex);
            for (const resource of pageIndex.values()) {
              if (resource.type === 'member') {
                const reward = patreonRelated(resource, 'reward', pageIndex)[0];
                if (reward && reward.id != null && String(reward.id) !== '-1') {
                  unlocked.add(String(reward.id));
                  unlocked.add(PATREONS_PLAN_KEY);
                }
              }
              if (resource.type === 'free-membership-subscription') unlocked.add(FREE_PLAN_KEY);
              if (resource.type === 'pledge') {
                unlocked.add(PATREONS_PLAN_KEY);
                const cents = Number((resource.attributes || {}).amount_cents) || 0;
                for (const plan of state.plans.values()) {
                  const priceCents = Math.round((Number(plan.price) || 0) * 100);
                  if (priceCents > 0 && priceCents <= cents) unlocked.add(String(plan.id));
                }
              }
            }
          }
        }
      }
      return unlocked;
    } catch (error) {
      if (signal && signal.aborted) throw error;
      log(`Patreon 已解锁方案检测失败：${error.message}`, 'warn');
      return null;
    }
  }

  function harvestPatreonBannerLinks(html) {
    const source = String(html || '');
    const found = [];
    const seen = new Set();
    const push = (value) => {
      let url = decodeHtmlEntities(String(value || '').trim());
      if (!url) return;
      url = url.replace(/&amp;/gi, '&');
      if (!/^https?:\/\//i.test(url)) return;
      if (/patreon\.com/i.test(url) && !looksLikeCloudUrl(url)) return;
      if (seen.has(url)) return;
      seen.add(url);
      found.push(url);
    };
    const patterns = [
      /href="(https?:\/\/[^"]+)"[^>]*(?:SmallLinkBanner|LinkPreview|linkBanner|ExternalLink|link-card)/gi,
      /href='(https?:\/\/[^']+)'[^>]*(?:SmallLinkBanner|LinkPreview|linkBanner|ExternalLink|link-card)/gi,
      /(?:SmallLinkBanner|LinkPreview|linkBanner|ExternalLink|link-card)[\s\S]{0,320}?href="(https?:\/\/[^"]+)"/gi,
      /(?:SmallLinkBanner|LinkPreview|linkBanner|ExternalLink|link-card)[\s\S]{0,320}?href='(https?:\/\/[^']+)'/gi,
    ];
    for (const re of patterns) {
      for (const match of source.matchAll(re)) push(match[1]);
    }
    for (const match of source.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
      if (looksLikeCloudUrl(match[1])) push(match[1]);
    }
    for (const match of source.matchAll(/href='(https?:\/\/[^']+)'/gi)) {
      if (looksLikeCloudUrl(match[1])) push(match[1]);
    }
    return found;
  }

  function mergePatreonTeaserLinks(post, links) {
    if (!post || !links || !links.length) return;
    post.attributes = post.attributes || {};
    const extra = links.join('\n');
    post.attributes.content_teaser_text = [post.attributes.content_teaser_text || '', extra].filter(Boolean).join('\n');
  }

  async function fetchPatreonPost(postId, signal) {
    const tries = [
      `/api/posts/${postId}${patreonQuery({
        include: PATREON_POST_INCLUDE,
        'fields[campaign]': 'currency,name,url,avatar_photo_url,is_nsfw,patron_count,vanity,creation_name',
        'fields[post]': PATREON_POST_FIELDS,
        'fields[post_tag]': 'tag_type,value',
        'fields[user]': 'image_url,full_name,url,vanity',
        'fields[access_rule]': 'access_rule_type,amount_cents',
        'fields[media]': 'id,image_urls,display,download_url,metadata,file_name,state,size_bytes',
        'fields[reward]': 'amount_cents,title,description,is_free_tier,patron_amount_cents,published',
        'fields[collection]': 'title,url,post_ids,num_posts',
        'json-api-use-default-includes': false,
        'json-api-version': '1.0',
      })}`,
    ];
    let lastError = null;
    for (const endpoint of tries) {
      try {
        const data = await requestPatreon(endpoint, { signal });
        if (!data || !data.data) throw new Error('接口没有返回投稿数据');
        const index = patreonResourceIndex(data);
        registerPatreonRewardsFromIndex(index);
        for (const resource of index.values()) {
          if (resource.type === 'collection') rememberPatreonCollection(resource);
        }
        const post = data.data;
        // If user is currently viewing this post, also scrape on-page link cards.
        try {
          if (typeof location !== 'undefined' && String(location.href || '').includes(String(postId))) {
            const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
            const bannerLinks = anchors
              .filter((a) => /SmallLinkBanner|LinkPreview|linkBanner|ExternalLink|link-card/i.test(`${a.className || ''} ${a.parentElement && a.parentElement.className || ''}`) || looksLikeCloudUrl(a.href))
              .map((a) => a.href)
              .filter(Boolean);
            mergePatreonTeaserLinks(post, bannerLinks);
            mergePatreonTeaserLinks(post, harvestPatreonBannerLinks(document.documentElement ? document.documentElement.outerHTML : ''));
          }
        } catch (_) { /* DOM scrape is best-effort */ }
        return { post, index };
      } catch (error) {
        if (signal && signal.aborted) throw error;
        lastError = error;
      }
    }

    // Fallback to page bootstrap when API shape differs.
    try {
      const html = await requestPatreon(`/posts/${postId}`, { json: false, signal });
      const page = parsePatreonPage(html);
      const index = patreonResourceIndex(page);
      const post = index.get(`post:${postId}`) || Array.from(index.values()).find((row) => row.type === 'post');
      if (!post) throw lastError || new Error('Patreon 页面没有投稿数据');
      registerPatreonRewardsFromIndex(index);
      for (const resource of index.values()) {
        if (resource.type === 'collection') rememberPatreonCollection(resource);
      }
      // Harvest visible link-card anchors (SmallLinkBanner etc.) that may not appear in content_json.
      mergePatreonTeaserLinks(post, harvestPatreonBannerLinks(html));
      return { post, index };
    } catch (error) {
      throw lastError || error;
    }
  }

  async function listPatreonPosts(campaignId, signal, onPage, options = {}) {
    const seen = new Set();
    const cards = [];
    let nextUrl = buildPatreonPostsUrl(campaignId);
    let page = 0;
    const stopBeforeMs = options.stopBeforeMs == null ? null : Number(options.stopBeforeMs);
    while (nextUrl && page < 1000) {
      page += 1;
      const data = await requestPatreon(nextUrl, { signal });
      const index = patreonResourceIndex(data);
      registerPatreonRewardsFromIndex(index);
      for (const resource of index.values()) {
        if (resource.type === 'collection') rememberPatreonCollection(resource);
      }
      const posts = Array.isArray(data.data) ? data.data : [];
      let fresh = 0;
      let reachedOld = false;
      for (const post of posts) {
        const id = String(post.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const attrs = post.attributes || {};
        const publishedMs = parseDate(attrs.published_at) ?? parseDate(attrs.edited_at) ?? parseDate(attrs.created_at);
        const updatedMs = parseDate(attrs.edited_at) ?? publishedMs;
        // Newest-first listing: once published_at is older than the lower bound, later pages are older too.
        if (stopBeforeMs != null && publishedMs != null && publishedMs < stopBeforeMs) {
          reachedOld = true;
          continue;
        }
        cards.push({
          id,
          title: attrs.title || '',
          publishedMs,
          updatedMs,
          canView: attrs.current_user_can_view !== false,
          collectionIds: collectionIdsForPost(id, patreonRelated(post, 'collections', index).map((item) => String(item.id))),
        });
        fresh += 1;
      }
      onPage(page, cards.length);
      if (reachedOld) {
        log(`Patreon 列表已到达起始日期之前，提前结束翻页（已收集 ${cards.length} 个）`);
        break;
      }
      nextUrl = (data.links && (data.links.next || data.links.Next)) || null;
      if (!nextUrl || !fresh) break;
      await sleepAbortable(Math.max(200, settings.requestDelay), signal);
    }
    return cards;
  }


  async function getCsrfToken() {
    if (state.csrfToken) return state.csrfToken;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) {
      state.csrfToken = meta.content;
      return state.csrfToken;
    }
    const response = await fetch(`${FANTIA_ORIGIN}/`, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    state.csrfToken = (doc.querySelector('meta[name="csrf-token"]') || {}).content || '';
    return state.csrfToken;
  }

  async function requestFantia(url, options = {}, attempt = 1) {
    const json = options.json !== false;
    const headers = {};
    if (json) {
      headers.Accept = 'application/json, text/plain, */*';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['X-CSRF-Token'] = await getCsrfToken();
    }
    let response;
    try {
      response = await fetch(absUrl(url, FANTIA_ORIGIN), { credentials: 'include', headers, signal: options.signal });
    } catch (error) {
      if (options.signal && options.signal.aborted) throw error;
      if (attempt < 4) {
        await sleepAbortable(1500 * attempt, options.signal);
        return requestFantia(url, options, attempt + 1);
      }
      throw error;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      log(`请求过快或服务器繁忙（HTTP ${response.status}），${4 * attempt} 秒后重试…`, 'warn');
      await sleepAbortable(4000 * attempt, options.signal);
      return requestFantia(url, options, attempt + 1);
    }
    if (json && [401, 403, 422].includes(response.status) && attempt === 1) {
      state.csrfToken = '';
      return requestFantia(url, options, attempt + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return json ? response.json() : response.text();
  }

  function fanboxQuery(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      if (typeof value === 'boolean') search.set(key, value ? 'true' : 'false');
      else search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `?${query}` : '';
  }

  async function requestFanbox(pathOrUrl, options = {}, attempt = 1) {
    const url = /^https?:/i.test(pathOrUrl)
      ? pathOrUrl
      : `${FANBOX_API}/${String(pathOrUrl).replace(/^\//, '')}`;
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: FANBOX_WWW,
          Referer: `${FANBOX_WWW}/`,
        },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal && options.signal.aborted) throw error;
      if (attempt < 4) {
        await sleepAbortable(1500 * attempt, options.signal);
        return requestFanbox(pathOrUrl, options, attempt + 1);
      }
      throw error;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      log(`Fanbox 请求过快或服务器繁忙（HTTP ${response.status}），${4 * attempt} 秒后重试…`, 'warn');
      await sleepAbortable(4000 * attempt, options.signal);
      return requestFanbox(pathOrUrl, options, attempt + 1);
    }
    if (!response.ok) {
      const label = /^https?:/i.test(pathOrUrl)
        ? pathOrUrl.replace(/^https?:\/\/[^/]+\/?/, '')
        : String(pathOrUrl);
      throw new Error(`HTTP ${response.status} (${label})`);
    }
    return response.json();
  }

  async function request(url, options = {}, attempt = 1) {
    // Backward-compatible Fantia helper used by older call sites.
    return requestFantia(url, options, attempt);
  }

  async function requestPawchive(pathOrUrl, options = {}, attempt = 1) {
    const url = /^https?:/i.test(pathOrUrl)
      ? pathOrUrl
      : absUrl(pathOrUrl, PAWCHIVE_ORIGIN);
    // Same-origin pages can use fetch; cross-origin helpers (e.g. iframely) need GM XHR.
    const sameOrigin = (() => {
      try {
        return new URL(url).origin === PAWCHIVE_ORIGIN || (typeof location !== 'undefined' && new URL(url).origin === location.origin);
      } catch (_) {
        return false;
      }
    })();
    if (!sameOrigin && typeof GM_xmlhttpRequest === 'function') {
      try {
        const html = await new Promise((resolve, reject) => {
          const req = GM_xmlhttpRequest({
            method: 'GET',
            url,
            anonymous: false,
            responseType: 'text',
            onload: (response) => {
              if (response.status >= 200 && response.status < 300) resolve(response.responseText || '');
              else reject(new Error(`HTTP ${response.status}`));
            },
            onerror: () => reject(new Error('network error')),
            ontimeout: () => reject(new Error('timeout')),
          });
          if (options.signal) {
            const onAbort = () => {
              try { if (req && typeof req.abort === 'function') req.abort(); } catch (_) { /* ignore */ }
              reject(new DOMException('Aborted', 'AbortError'));
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener('abort', onAbort, { once: true });
          }
        });
        return html;
      } catch (error) {
        if (options.signal && options.signal.aborted) throw error;
        if (attempt < 4 && error && error.name !== 'AbortError') {
          await sleepAbortable(1500 * attempt, options.signal);
          return requestPawchive(pathOrUrl, options, attempt + 1);
        }
        throw error;
      }
    }
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal && options.signal.aborted) throw error;
      if (attempt < 4) {
        await sleepAbortable(1500 * attempt, options.signal);
        return requestPawchive(pathOrUrl, options, attempt + 1);
      }
      throw error;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      log(`Pawchive 请求过快或服务器繁忙（HTTP ${response.status}），${4 * attempt} 秒后重试…`, 'warn');
      await sleepAbortable(4000 * attempt, options.signal);
      return requestPawchive(pathOrUrl, options, attempt + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function extractCanonicalOrCloudFromHtml(html) {
    const text = String(html || '');
    const canonical = text.match(/<meta[^>]+name=["']canonical["'][^>]+content=["']([^"']+)["'][^>]*>/i)
      || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']canonical["'][^>]*>/i)
      || text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
    const canonicalUrl = canonical ? decodeHtmlEntities(canonical[1]).trim() : '';
    if (canonicalUrl && looksLikeCloudUrl(canonicalUrl) && !isIframelyUrl(canonicalUrl)) {
      return canonicalUrl.replace(/\\+$/g, '');
    }
    const urls = extractUrlsFromText(decodeHtmlEntities(text));
    for (const url of urls) {
      if (looksLikeCloudUrl(url) && !isIframelyUrl(url)) return String(url).replace(/\\+$/g, '');
    }
    return '';
  }

  function isIframelyUrl(url) {
    const value = String(url || '').trim();
    if (!value) return false;
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'iframely.net'
        || host === 'iframe.ly'
        || host.endsWith('.iframely.net')
        || host.endsWith('.iframe.ly');
    } catch (_) {
      return /(?:^|[\/.:])(?:iframely\.net|iframe\.ly)(?:[:/?#]|$)/i.test(value);
    }
  }

  function iframelyIdFromUrl(url) {
    const value = decodeHtmlEntities(String(url || '').trim());
    const match = value.match(/(?:iframely\.net|iframe\.ly)\/([A-Za-z0-9_-]{5,})/i);
    return match ? match[1] : '';
  }

  async function requestExternalText(url, options = {}, attempt = 1) {
    const target = String(url || '').trim();
    if (!target) throw new Error('empty url');
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        return await new Promise((resolve, reject) => {
          const req = GM_xmlhttpRequest({
            method: 'GET',
            url: target,
            anonymous: true,
            responseType: 'text',
            headers: {
              Accept: options.accept || 'application/json,text/html,*/*',
            },
            onload: (response) => {
              if (response.status >= 200 && response.status < 300) resolve(response.responseText || '');
              else reject(new Error(`HTTP ${response.status}`));
            },
            onerror: () => reject(new Error('network error')),
            ontimeout: () => reject(new Error('timeout')),
          });
          if (options.signal) {
            const onAbort = () => {
              try { if (req && typeof req.abort === 'function') req.abort(); } catch (_) { /* ignore */ }
              reject(new DOMException('Aborted', 'AbortError'));
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      } catch (error) {
        if (options.signal && options.signal.aborted) throw error;
        if (attempt < 3 && error && error.name !== 'AbortError') {
          await sleepAbortable(1000 * attempt, options.signal);
          return requestExternalText(url, options, attempt + 1);
        }
        throw error;
      }
    }
    const response = await fetch(target, {
      credentials: 'omit',
      headers: { Accept: options.accept || 'application/json,text/html,*/*' },
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function cloudUrlFromIframelyPayload(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') {
      try {
        return cloudUrlFromIframelyPayload(JSON.parse(payload));
      } catch (_) {
        return extractCanonicalOrCloudFromHtml(payload);
      }
    }
    const candidates = [
      payload.url,
      payload.canonical,
      payload.meta && payload.meta.canonical,
      payload.meta && payload.meta.url,
    ];
    for (const item of candidates) {
      const url = decodeHtmlEntities(String(item || '').trim()).replace(/\\+$/g, '');
      if (url && looksLikeCloudUrl(url) && !isIframelyUrl(url)) return url;
    }
    return '';
  }

  async function resolveIframelyCloudUrl(url, signal) {
    const target = decodeHtmlEntities(String(url || '').trim());
    if (!target || !isIframelyUrl(target)) return '';
    const id = iframelyIdFromUrl(target);
    const endpoints = [];
    if (id) {
      endpoints.push(`https://cdn.iframe.ly/${id}.json`);
      endpoints.push(`https://iframely.net/${id}.json`);
      endpoints.push(`https://cdn.iframe.ly/${id}`);
      endpoints.push(`https://iframely.net/${id}`);
    }
    endpoints.push(target);
    let lastError = '';
    try {
      for (const endpoint of endpoints) {
        try {
          const body = await requestExternalText(endpoint, {
            signal,
            accept: /\.json(?:$|\?)/i.test(endpoint) ? 'application/json,*/*' : 'text/html,*/*',
          });
          const resolved = cloudUrlFromIframelyPayload(body);
          if (resolved) return resolved;
          lastError = `empty payload from ${endpoint}`;
        } catch (error) {
          if (signal && signal.aborted) throw error;
          lastError = `${endpoint} → ${error.message}`;
        }
      }
      if (lastError) log(`iframely 未能还原：${lastError}`, 'warn');
      return '';
    } catch (error) {
      if (signal && signal.aborted) throw error;
      log(`iframely 解析失败：${error.message}`, 'warn');
      return '';
    }
  }

  async function resolvePawchiveCloudLinks(entry, signal) {
    if (!entry) return entry;
    const pending = [];
    const seen = new Set();
    for (const link of entry.cloudLinks || []) {
      if (link && isIframelyUrl(link.url) && !seen.has(link.url)) {
        seen.add(link.url);
        pending.push(link.url);
      }
    }
    // Also scan text item for leftover iframely urls.
    for (const item of entry.items || []) {
      if (item.kind !== 'text' || !item.text) continue;
      for (const url of extractUrlsFromText(item.text)) {
        if (isIframelyUrl(url) && !seen.has(url)) {
          seen.add(url);
          pending.push(url);
        }
      }
    }
    if (!pending.length) return entry;

    log(`正在解析 ${pending.length} 个 iframely 卡片链接…`);

    const resolved = [];
    for (const wrap of pending) {
      const cloud = await resolveIframelyCloudUrl(wrap, signal);
      if (cloud) resolved.push({ from: wrap, to: cloud });
      if (signal && signal.aborted) break;
      await sleepAbortable(Math.max(120, Math.floor(settings.requestDelay / 3)), signal);
    }
    if (!resolved.length) {
      log('卡片链接未能还原为真实网盘地址，已保留原始 iframely 链接', 'warn');
      return entry;
    }

    const map = new Map(resolved.map((item) => [item.from, item.to]));
    entry.cloudLinks = (entry.cloudLinks || [])
      .map((link) => {
        if (!map.has(link.url)) return link;
        const next = map.get(link.url);
        return {
          url: next,
          provider: cloudProviderLabel(next),
          code: link.code || '',
        };
      })
      .filter((link, index, arr) => arr.findIndex((other) => other.url === link.url) === index);

    for (const item of resolved) {
      if (!entry.cloudLinks.some((link) => link.url === item.to)) {
        entry.cloudLinks.push({
          url: item.to,
          provider: cloudProviderLabel(item.to),
          code: '',
        });
      }
    }

    // Drop unresolved markers if at least one real cloud link exists now.
    const unresolvedLeft = pending.some((wrap) => !map.has(wrap));
    if (!unresolvedLeft) {
      entry.unresolvedLinkPosts = (entry.unresolvedLinkPosts || []).filter((row) => row.reason !== '卡片链接待解析');
    }
    log(`已还原 ${resolved.length} 个卡片链接`, 'ok');
    return entry;
  }

  async function fetchFantiaPost(postId, signal) {
    const data = await requestFantia(`/api/v1/posts/${postId}`, { signal });
    if (!data || !data.post) throw new Error('接口没有返回投稿数据');
    return data.post;
  }

  async function fetchFanboxPost(postId, signal) {
    const data = await requestFanbox(`post.info${fanboxQuery({ postId })}`, { signal });
    const post = data && (data.body && data.body.post ? data.body.post : data.post || data.body);
    if (!post || post.id == null) throw new Error('Fanbox 接口没有返回投稿数据');
    return post;
  }

  function currentPageLooksLikeFanboxPost(postId) {
    const id = String(postId || '');
    if (!id || typeof location === 'undefined') return false;
    if (detectSite(location.href) !== 'fanbox') return false;
    const match = String(location.pathname || '').match(/\/posts\/(\d+)/i);
    return !!(match && match[1] === id);
  }

  function harvestFanboxDomCloudLinks(postId) {
    if (!currentPageLooksLikeFanboxPost(postId) || typeof document === 'undefined') return [];
    const roots = [
      document.querySelector('article'),
      document.querySelector('[class*="Post"]'),
      document.body,
    ].filter(Boolean);
    const found = [];
    const seen = new Set();
    for (const root of roots) {
      const anchors = root.querySelectorAll('a.thl[href], a[href*="mega.nz"], a[href*="mega.co.nz"], a[href*="drive.google"], a[href*="dropbox.com"], a[href*="iframely.net"], a[href*="iframe.ly"]');
      for (const anchor of anchors) {
        const href = decodeHtmlEntities(anchor.getAttribute('href') || anchor.href || '').trim();
        if (!href || seen.has(href)) continue;
        if (!(looksLikeCloudUrl(href) || isIframelyUrl(href))) continue;
        seen.add(href);
        found.push(href);
      }
      if (found.some((url) => looksLikeCloudUrl(url) && !isIframelyUrl(url))) break;
    }
    return found;
  }

  async function resolveFanboxCloudLinks(entry, signal) {
    if (!entry || !entry.meta) return entry;
    const pendingWraps = [];
    const seenWrap = new Set();
    const pushWrap = (url) => {
      const value = decodeHtmlEntities(String(url || '').trim());
      if (!value || !isIframelyUrl(value) || seenWrap.has(value)) return;
      seenWrap.add(value);
      pendingWraps.push(value);
    };

    for (const link of entry.cloudLinks || []) pushWrap(link.url);
    for (const item of entry.items || []) {
      if (item.kind === 'text' && item.text) {
        for (const url of extractUrlsFromText(item.text)) pushWrap(url);
      }
    }

    // Prefer live page DOM when viewing the same post: Fanbox renders real MEGA anchors there.
    const domLinks = harvestFanboxDomCloudLinks(entry.meta.id);
    if (domLinks.length) {
      recordCloudLinks(entry, domLinks);
      for (const url of domLinks) pushWrap(url);
    }

    const hasReal = (entry.cloudLinks || []).some((link) => looksLikeCloudUrl(link.url) && !isIframelyUrl(link.url));
    if (hasReal) {
      entry.unresolvedLinkPosts = (entry.unresolvedLinkPosts || []).filter((row) => !/卡片链接待解析|未能提取链接|卡片类型无法提取链接/.test(String(row.reason || '')));
      // Drop leftover iframely wrappers once real destinations exist.
      entry.cloudLinks = (entry.cloudLinks || []).filter((link) => !isIframelyUrl(link.url));
      return entry;
    }

    if (!pendingWraps.length) return entry;
    log(`正在解析 ${pendingWraps.length} 个 Fanbox 卡片链接…`);
    const resolved = [];
    for (const wrap of pendingWraps) {
      const cloud = await resolveIframelyCloudUrl(wrap, signal);
      if (cloud) resolved.push({ from: wrap, to: cloud });
      if (signal && signal.aborted) break;
      await sleepAbortable(Math.max(120, Math.floor(settings.requestDelay / 3)), signal);
    }
    if (!resolved.length) {
      log('Fanbox 卡片链接未能还原为真实网盘地址', 'warn');
      return entry;
    }

    const map = new Map(resolved.map((item) => [item.from, item.to]));
    entry.cloudLinks = (entry.cloudLinks || [])
      .map((link) => {
        if (!map.has(link.url)) return link;
        const next = map.get(link.url);
        return { url: next, provider: cloudProviderLabel(next), code: link.code || '' };
      })
      .filter((link, index, arr) => arr.findIndex((other) => other.url === link.url) === index)
      .filter((link) => !isIframelyUrl(link.url));

    for (const item of resolved) {
      if (!entry.cloudLinks.some((link) => link.url === item.to)) {
        entry.cloudLinks.push({ url: item.to, provider: cloudProviderLabel(item.to), code: '' });
      }
    }
    entry.unresolvedLinkPosts = (entry.unresolvedLinkPosts || []).filter((row) => !/卡片链接待解析|未能提取链接|卡片类型无法提取链接/.test(String(row.reason || '')));
    log(`已还原 ${resolved.length} 个 Fanbox 卡片链接`, 'ok');
    return entry;
  }

  function rememberPawchivePostHint(cardOrHint) {
    if (!cardOrHint || cardOrHint.id == null) return;
    const id = String(cardOrHint.id);
    const prev = state.pawPostHints.get(id) || {};
    const next = {
      ...prev,
      id,
      service: cardOrHint.service || prev.service || (state.fanclub && state.fanclub.service) || '',
      userId: cardOrHint.userId || prev.userId || (state.fanclub && state.fanclub.userId) || '',
      url: cardOrHint.href || cardOrHint.url || prev.url || '',
      user: cardOrHint.user || prev.user || (state.fanclub && state.fanclub.user) || '',
      title: cardOrHint.title || prev.title || '',
    };
    if (!next.url && next.service && next.userId) {
      next.url = pawchivePostUrl(next.service, next.userId, id);
    }
    state.pawPostHints.set(id, next);
  }

  async function fetchPawchivePost(postId, signal, hintInput) {
    const id = String(postId);
    const hint = hintInput || state.pawPostHints.get(id) || {};
    let service = hint.service || (state.fanclub && state.fanclub.service) || '';
    let userId = hint.userId || (state.fanclub && state.fanclub.userId) || '';
    let url = hint.url || hint.href || '';
    if (!url) {
      if (!service || !userId) throw new Error(`缺少 Pawchive 作者信息，无法读取投稿 #${id}`);
      url = pawchivePostUrl(service, userId, id);
    }
    const html = await requestPawchive(url, { signal });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let entry = extractPawchivePost(doc, {
      postId: id,
      service,
      userId,
      url,
      user: hint.user || '',
    });
    entry = await resolvePawchiveCloudLinks(entry, signal);
    rememberPawchivePostHint({
      id: entry.meta.id,
      service: entry.meta.service,
      userId: entry.meta.fanclubId,
      url: entry.meta.url,
      user: entry.meta.user,
      title: entry.meta.title,
    });
    return entry;
  }

  async function listPawchivePosts(ownerId, signal, onPage, options = {}) {
    const parts = splitPawchiveOwner(ownerId);
    if (!parts || !parts.service || !parts.userId) throw new Error('Pawchive 作者 ID 无效');
    const seen = new Set();
    const cards = [];
    const stopBeforeMs = options.stopBeforeMs == null ? null : Number(options.stopBeforeMs);
    let offset = 0;
    let page = 0;
    for (let guard = 0; guard < 1000; guard += 1) {
      page += 1;
      const html = await requestPawchive(pawchiveUserUrl(parts.service, parts.userId, offset || 0), { signal });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!state.fanclub || state.fanclub.site !== 'pawchive' || String(state.fanclub.id) !== String(ownerId)) {
        state.fanclub = parsePawchiveUserFromDoc(doc, parts);
      }
      let fresh = 0;
      let reachedOld = false;
      for (const card of parsePawchiveListCards(doc)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        rememberPawchivePostHint(card);
        if (stopBeforeMs != null && card.publishedMs != null && card.publishedMs < stopBeforeMs) {
          reachedOld = true;
          continue;
        }
        cards.push(card);
        fresh += 1;
      }
      if (typeof onPage === 'function') onPage(page, cards.length);

      let nextOffset = null;
      for (const anchor of Array.from(doc.querySelectorAll('a[href*="?o="]'))) {
        try {
          const href = absUrl(anchor.getAttribute('href') || '', PAWCHIVE_ORIGIN);
          const url = new URL(href);
          const o = Number(url.searchParams.get('o'));
          if (!Number.isFinite(o)) continue;
          if (o > offset && (nextOffset == null || o < nextOffset)) nextOffset = o;
        } catch (_) { /* ignore */ }
      }

      if (reachedOld) {
        log(`Pawchive 列表已到达起始日期之前，提前结束翻页（已收集 ${cards.length} 个）`);
        break;
      }
      if (nextOffset == null || nextOffset <= offset || !fresh) break;
      offset = nextOffset;
      await sleepAbortable(Math.max(200, settings.requestDelay), signal);
    }
    return cards;
  }

  async function fetchPost(postId, signal, site = 'fantia') {
    if (site === 'fanbox') return fetchFanboxPost(postId, signal);
    if (site === 'patreon') return fetchPatreonPost(postId, signal);
    if (site === 'pawchive') throw new Error('Pawchive 请使用带作者信息的抓取路径');
    return fetchFantiaPost(postId, signal);
  }

  async function getPostEntry(postId, signal, site = 'fantia') {
    const cached = state.posts.get(String(postId));
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      // Older cache may still hold unresolved iframely wrappers; refresh them.
      if (site === 'pawchive' || site === 'fanbox') {
        const pending = (cached.cloudLinks || []).some((link) => isIframelyUrl(link && link.url))
          || (cached.unresolvedLinkPosts || []).some((row) => /卡片链接待解析/.test(String(row && row.reason || '')));
        if (pending) {
          const refreshed = site === 'fanbox'
            ? await resolveFanboxCloudLinks(cached, signal)
            : await resolvePawchiveCloudLinks(cached, signal);
          state.posts.set(refreshed.meta.id, refreshed);
          return { entry: refreshed, fresh: true };
        }
      }
      return { entry: cached, fresh: false };
    }
    let entry;
    let raw = null;
    if (site === 'pawchive') {
      entry = await fetchPawchivePost(postId, signal);
    } else {
      raw = await fetchPost(postId, signal, site);
      if (site === 'patreon') {
        const payload = raw && raw.post ? raw : { post: raw, index: null };
        entry = extractPost(payload.post, site, payload.index);
        attachPatreonCollections(entry);
      } else if (site === 'fanbox') {
        entry = extractPost(raw, site);
        entry = await resolveFanboxCloudLinks(entry, signal);
      } else {
        entry = extractPost(raw, site);
      }
    }
    state.posts.set(entry.meta.id, entry);
    registerPlans(entry);
    if (!state.fanclub) {
      if (site === 'fanbox') {
        state.fanclub = {
          id: entry.meta.creatorId || entry.meta.fanclubId || '',
          name: entry.meta.fanclub || '',
          user: entry.meta.user || '',
          site: 'fanbox',
        };
      } else if (site === 'patreon') {
        state.fanclub = {
          id: entry.meta.fanclubId || '',
          name: entry.meta.fanclub || entry.meta.user || entry.meta.creatorId || '',
          user: entry.meta.creatorId || entry.meta.user || entry.meta.fanclubId || '',
          creatorId: entry.meta.creatorId || '',
          site: 'patreon',
        };
      } else if (site === 'pawchive') {
        const parts = splitPawchiveOwner(entry.meta.creatorId) || {
          service: entry.meta.service || '',
          userId: entry.meta.fanclubId || '',
        };
        state.fanclub = {
          id: entry.meta.creatorId || pawchiveOwnerKey(parts.service, parts.userId),
          name: entry.meta.user || parts.userId || '',
          user: entry.meta.user || parts.userId || '',
          service: parts.service || '',
          userId: parts.userId || '',
          site: 'pawchive',
        };
      } else if (raw && raw.fanclub) {
        state.fanclub = {
          id: String(raw.fanclub.id),
          name: raw.fanclub.name || '',
          user: raw.fanclub.creator_name || '',
          site: 'fantia',
        };
      }
    }
    return { entry, fresh: true };
  }

  async function resolveFanclubId(target, signal) {
    const site = targetSite(target);
    if (site === 'patreon') {
      const fanclub = await resolvePatreonCampaign(target, signal);
      return fanclub.id;
    }
    if (site === 'pawchive') {
      if (target.creatorId) return target.creatorId;
      if (target.service && target.userId) return pawchiveOwnerKey(target.service, target.userId);
      if (target.postId) {
        const { entry } = await getPostEntry(target.postId, signal, 'pawchive');
        if (!entry.meta.creatorId) throw new Error('无法从投稿中识别 Pawchive 作者');
        return entry.meta.creatorId;
      }
      throw new Error('请输入 Pawchive 作者主页或投稿链接');
    }
    if (target.fanclubId) return target.fanclubId;
    if (target.creatorId) return target.creatorId;
    const { entry } = await getPostEntry(target.postId, signal, site);
    if (site === 'fanbox') {
      if (!entry.meta.creatorId && !entry.meta.fanclubId) throw new Error('无法从投稿中识别 Fanbox 作者');
      return entry.meta.creatorId || entry.meta.fanclubId;
    }
    if (!entry.meta.fanclubId) throw new Error('无法从投稿中识别作者');
    return entry.meta.fanclubId;
  }

  async function listFantiaPosts(fanclubId, signal, onPage, options = {}) {
    const seen = new Set();
    const cards = [];
    const stopBeforeMs = options.stopBeforeMs == null ? null : Number(options.stopBeforeMs);
    for (let page = 1; page <= 1000; page += 1) {
      const html = await requestFantia(`/fanclubs/${fanclubId}/posts?page=${page}`, { json: false, signal });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let fresh = 0;
      let reachedOld = false;
      for (const card of parsePostCards(doc)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        if (stopBeforeMs != null && card.updatedMs != null && card.updatedMs < stopBeforeMs) {
          reachedOld = true;
          continue;
        }
        cards.push(card);
        fresh += 1;
      }
      onPage(page, cards.length);
      if (reachedOld) {
        log(`Fantia 列表已到达起始日期之前，提前结束翻页（已收集 ${cards.length} 个）`);
        break;
      }
      if (!fresh || !doc.querySelector('.pagination a[rel="next"], a[rel="next"]')) break;
      await sleepAbortable(Math.max(200, settings.requestDelay), signal);
    }
    return cards;
  }

  async function listFanboxPosts(creatorId, signal, onPage, options = {}) {
    const seen = new Set();
    const cards = [];
    let nextUrl = null;
    let page = 0;
    const stopBeforeMs = options.stopBeforeMs == null ? null : Number(options.stopBeforeMs);

    const pushPost = (post) => {
      const id = String(post.id);
      if (seen.has(id)) return { fresh: 0, old: false };
      seen.add(id);
      const publishedMs = parseDate(post.publishedDatetime);
      const updatedMs = parseDate(post.updatedDatetime) ?? publishedMs;
      if (stopBeforeMs != null && publishedMs != null && publishedMs < stopBeforeMs) {
        return { fresh: 0, old: true };
      }
      if (stopBeforeMs != null && publishedMs == null && updatedMs != null && updatedMs < stopBeforeMs) {
        return { fresh: 0, old: true };
      }
      cards.push({
        id,
        title: post.title || '',
        publishedMs,
        updatedMs,
        feeRequired: post.feeRequired,
        isRestricted: !!post.isRestricted,
      });
      return { fresh: 1, old: false };
    };

    // Prefer official pagination URLs when available.
    try {
      const paged = await requestFanbox(`post.paginateCreator${fanboxQuery({ creatorId, sort: 'newest' })}`, { signal });
      const pageUrls = (paged && paged.body && paged.body.pageUrls) || (paged && paged.pageUrls) || [];
      if (Array.isArray(pageUrls) && pageUrls.length) {
        for (const pageUrl of pageUrls) {
          if (signal && signal.aborted) break;
          page += 1;
          const data = await requestFanbox(pageUrl, { signal });
          const posts = (data && data.body && data.body.posts) || (data && data.posts) || [];
          let fresh = 0;
          let reachedOld = false;
          for (const post of posts) {
            const result = pushPost(post);
            fresh += result.fresh;
            if (result.old) reachedOld = true;
          }
          onPage(page, cards.length);
          if (reachedOld) {
            log(`Fanbox 列表已到达起始日期之前，提前结束翻页（已收集 ${cards.length} 个）`);
            break;
          }
          if (!fresh) break;
          await sleepAbortable(Math.max(200, settings.requestDelay), signal);
        }
        return cards;
      }
    } catch (error) {
      if (signal && signal.aborted) throw error;
      log(`Fanbox 分页目录读取失败，改用连续翻页：${error.message}`, 'warn');
    }

    while (page < 1000) {
      page += 1;
      let data;
      if (nextUrl) {
        data = await requestFanbox(nextUrl, { signal });
      } else {
        try {
          data = await requestFanbox(`post.listCreator${fanboxQuery({ creatorId, limit: 10, withPinned: true })}`, { signal });
        } catch (error) {
          if (signal && signal.aborted) throw error;
          log(`Fanbox 带置顶列表失败，改用不带 withPinned：${error.message}`, 'warn');
          data = await requestFanbox(`post.listCreator${fanboxQuery({ creatorId, limit: 10 })}`, { signal });
        }
      }
      const body = (data && data.body) || data || {};
      const posts = body.posts || [];
      let fresh = 0;
      let reachedOld = false;
      for (const post of posts) {
        const result = pushPost(post);
        fresh += result.fresh;
        if (result.old) reachedOld = true;
      }
      onPage(page, cards.length);
      if (reachedOld) {
        log(`Fanbox 列表已到达起始日期之前，提前结束翻页（已收集 ${cards.length} 个）`);
        break;
      }
      nextUrl = body.nextUrl || null;
      if (!nextUrl || !fresh) break;
      await sleepAbortable(Math.max(200, settings.requestDelay), signal);
    }
    return cards;
  }

  async function listPosts(ownerId, signal, onPage, site = 'fantia', options = {}) {
    if (site === 'fanbox') return listFanboxPosts(ownerId, signal, onPage, options);
    if (site === 'patreon') return listPatreonPosts(ownerId, signal, onPage, options);
    if (site === 'pawchive') return listPawchivePosts(ownerId, signal, onPage, options);
    return listFantiaPosts(ownerId, signal, onPage, options);
  }

  async function ensurePlans(ownerId, signal, site = 'fantia') {
    if (!ownerId) return;
    const ownerKey = planOwnerKey(site, ownerId);
    const sameOwner = state.plansFor === String(ownerId) && state.fanclub && state.fanclub.site === site;
    // 同一作者只拉一次方案；若尚未完成自动勾选，则只补检测。
    if (sameOwner && state.unlockedPlanIds) return;
    if (sameOwner && !state.unlockedPlanIds && state.planAutoTried === ownerKey) return;
    if (state.planAutoKey !== ownerKey) state.planManual = false;

    if (!sameOwner) {
      state.plansFor = String(ownerId);
      state.plans = new Map();
      if (!((site === 'patreon' || site === 'pawchive') && state.fanclub && String(state.fanclub.id) === String(ownerId))) {
        state.fanclub = null;
      }
      state.unlockedPlanIds = null;
      state.planAutoTried = '';
      renderPlans('正在读取订阅方案…');
    }

    let creatorHint = null;
    let fantiaPlansHtml = '';

    if (site === 'pawchive') {
      const parts = splitPawchiveOwner(ownerId);
      if (!state.fanclub || state.fanclub.site !== 'pawchive' || String(state.fanclub.id) !== String(ownerId)) {
        if (parts) {
          try {
            const html = await requestPawchive(pawchiveUserUrl(parts.service, parts.userId), { signal });
            const doc = new DOMParser().parseFromString(html, 'text/html');
            state.fanclub = parsePawchiveUserFromDoc(doc, parts);
          } catch (error) {
            state.fanclub = {
              id: String(ownerId),
              name: (parts && parts.userId) || String(ownerId),
              user: (parts && parts.userId) || String(ownerId),
              service: (parts && parts.service) || '',
              userId: (parts && parts.userId) || '',
              site: 'pawchive',
            };
            log(`Pawchive 作者页读取失败，使用链接信息继续：${error.message}`, 'warn');
          }
        }
      }
      state.plans = new Map();
      renderTargetInfo();
      renderPlans('Pawchive 无订阅方案筛选');
      renderCollections();
      const unlocked = new Set([FREE_PLAN_KEY]);
      applyUnlockedPlanSelection(site, ownerId, unlocked);
      state.planAutoTried = ownerKey;
      return;
    }

    if (site === 'patreon') {
      try {
        if (!(state.fanclub && state.fanclub.site === 'patreon' && String(state.fanclub.id) === String(ownerId))) {
          await resolvePatreonCampaign({ site: 'patreon', campaignId: ownerId }, signal);
        }
        const campaignData = await requestPatreon(`/api/campaigns/${ownerId}${patreonQuery({
          include: 'rewards,creator',
          'fields[campaign]': 'name,url,vanity,currency,avatar_photo_url,patron_count,is_nsfw,creation_name',
          'fields[reward]': 'amount_cents,title,description,is_free_tier,patron_amount_cents,published',
          'fields[user]': 'full_name,url,vanity',
          'json-api-version': '1.0',
        })}`, { signal });
        const index = patreonResourceIndex(campaignData);
        registerPatreonRewardsFromIndex(index);
        const campaign = campaignData.data;
        const attrs = (campaign && campaign.attributes) || {};
        const slug = patreonCreatorSlug(campaign, state.fanclub && state.fanclub.creatorId);
        state.fanclub = {
          id: String(campaign.id || ownerId),
          name: attrs.name || slug || String(ownerId),
          user: slug || attrs.name || String(ownerId),
          creatorId: slug || '',
          site: 'patreon',
          currency: attrs.currency || 'USD',
        };
        // Also collect tiers seen from already fetched posts.
        for (const entry of state.posts.values()) {
          if (String(entry.meta.fanclubId) !== String(ownerId)) continue;
          for (const plan of entry.plans) if (plan && !state.plans.has(plan.id)) state.plans.set(plan.id, plan);
        }
        if (!state.plans.has(PATREONS_PLAN_KEY)) {
          state.plans.set(PATREONS_PLAN_KEY, normalizePlan({ id: PATREONS_PLAN_KEY, name: '所有付费赞助者', price: '' }));
        }
      } catch (error) {
        log(`Patreon 方案读取失败：${error.message}`, 'warn');
        if (!state.fanclub) state.fanclub = { id: String(ownerId), name: String(ownerId), user: String(ownerId), site: 'patreon' };
      }
    } else if (site === 'fanbox') {
      try {
        const [creatorData, planData] = await Promise.all([
          requestFanbox(`creator.get${fanboxQuery({ creatorId: ownerId })}`, { signal }),
          requestFanbox(`plan.listCreator${fanboxQuery({ creatorId: ownerId })}`, { signal }),
        ]);
        const creator = (creatorData && creatorData.body) || creatorData || {};
        creatorHint = creator;
        const user = creator.user || {};
        state.fanclub = {
          id: creator.creatorId || ownerId,
          name: creator.creatorId || user.name || ownerId,
          user: user.name || creator.creatorId || ownerId,
          site: 'fanbox',
        };
        const plans = (planData && planData.body && planData.body.plans) || (planData && planData.plans) || [];
        for (const plan of plans) {
          const fee = Number(plan.fee ?? plan.price) || 0;
          const normalized = normalizePlan({
            // Fanbox posts only expose feeRequired, so key plans by fee for stable filtering.
            id: fee > 0 ? `fee:${fee}` : (plan.id != null ? plan.id : 'free'),
            name: plan.title || plan.name || (fee > 0 ? `${fee.toLocaleString()}円` : '免费'),
            price: fee || '',
          });
          if (normalized) state.plans.set(normalized.id, normalized);
        }
      } catch (error) {
        log(`Fanbox 方案读取失败：${error.message}`, 'warn');
        state.fanclub = { id: ownerId, name: ownerId, user: ownerId, site: 'fanbox' };
      }
    } else {
      try {
        const data = await requestFantia(`/api/v1/fanclubs/${ownerId}`, { signal });
        const fanclub = data.fanclub || data;
        state.fanclub = {
          id: String(fanclub.id || ownerId),
          name: fanclub.name || fanclub.fanclub_name || '',
          user: fanclub.creator_name || (fanclub.user && fanclub.user.name) || '',
          site: 'fantia',
        };
        for (const plan of fanclub.plans || []) {
          const normalized = normalizePlan(plan);
          if (normalized) state.plans.set(normalized.id, normalized);
          if (plan && (plan.joined || plan.is_joined || plan.current || plan.joined_at)) {
            // API 若直接标记已加入，先记下来，后续 HTML 再补全。
            if (!state.unlockedPlanIds) state.unlockedPlanIds = new Set([FREE_PLAN_KEY]);
            state.unlockedPlanIds.add(String(normalized ? normalized.id : plan.id));
          }
        }
      } catch (error) {
        log(`方案接口读取失败，尝试解析方案页面：${error.message}`, 'warn');
        try {
          fantiaPlansHtml = await requestFantia(`/fanclubs/${ownerId}/plans`, { json: false, signal });
          const doc = new DOMParser().parseFromString(fantiaPlansHtml, 'text/html');
          for (const node of doc.querySelectorAll('[id^="plan-id-"]')) {
            const id = node.id.replace('plan-id-', '');
            const title = node.querySelector('.plan-title');
            const price = node.querySelector('.plan-price');
            const priceMatch = price && price.textContent.match(/([\d,]+)\s*(?:JPY|円|日元)/i);
            state.plans.set(id, {
              id,
              name: (title && title.textContent.trim()) || `方案 ${id}`,
              price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : '',
            });
          }
        } catch (fallbackError) {
          log(`方案页面读取失败：${fallbackError.message}`, 'warn');
        }
        const cachedEntry = Array.from(state.posts.values()).find((entry) => entry.meta.fanclubId === String(ownerId));
        if (cachedEntry) {
          state.fanclub = { id: String(ownerId), name: cachedEntry.meta.fanclub, user: cachedEntry.meta.user, site: 'fantia' };
        }
      }
    }

    for (const entry of state.posts.values()) {
      const sameOwnerEntry = site === 'fanbox'
        ? (entry.meta.creatorId === String(ownerId) || entry.meta.fanclubId === String(ownerId))
        : entry.meta.fanclubId === String(ownerId);
      if (!sameOwnerEntry) continue;
      for (const plan of entry.plans) if (plan && !state.plans.has(plan.id)) state.plans.set(plan.id, plan);
      if (site === 'patreon') attachPatreonCollections(entry);
    }

    let unlocked = state.unlockedPlanIds;
    if (site === 'patreon') {
      unlocked = await detectPatreonUnlockedPlanIds(ownerId, signal);
    } else if (site === 'fanbox') {
      unlocked = await detectFanboxUnlockedPlanIds(ownerId, signal, creatorHint);
    } else if (!unlocked || unlocked.size <= 1) {
      unlocked = fantiaPlansHtml
        ? (() => {
            const joined = parseFantiaJoinedPlanIds(fantiaPlansHtml, state.plans);
            const set = new Set([FREE_PLAN_KEY, ...joined]);
            return set;
          })()
        : await detectFantiaUnlockedPlanIds(ownerId, signal, state.plans);
    }

    renderTargetInfo();
    renderPlans();
    const applied = applyUnlockedPlanSelection(site, ownerId, unlocked);
    state.planAutoTried = ownerKey;
    if (!applied && unlocked) {
      // 用户已手动改过勾选时，仍记录检测结果，避免下次覆盖。
      state.unlockedPlanIds = new Set(Array.from(unlocked).map(String));
    }
  }

  function planOwnerKey(site, ownerId) {
    return `${site || 'fantia'}:${ownerId || ''}`;
  }

  function markPlanSelectionManual() {
    state.planManual = true;
  }

  function parseFantiaJoinedPlanIds(html, plans) {
    const joined = new Set();
    if (!html) return joined;
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const nodes = Array.from(doc.querySelectorAll('.module.plan, [id^="plan-id-"]'));
    for (const node of nodes) {
      const block = node.closest('.list-group-item') || node;
      const textContent = block.textContent || '';
      const unsub = block.querySelector('a[href*="/orders/delete"], a[href*="/users/plans/"][href*="delete"]');
      const joinedHint = !!(unsub || /退订方案|退会する|ご利用中|参加中|加入中/.test(textContent));
      if (!joinedHint) continue;

      const idNode = block.id && block.id.startsWith('plan-id-')
        ? block
        : (block.querySelector('[id^="plan-id-"]') || node);
      const id = idNode && idNode.id ? idNode.id.replace(/^plan-id-/, '') : '';
      if (id) joined.add(String(id));

      const titleNode = block.querySelector('.plan-title');
      const title = titleNode ? titleNode.textContent.trim() : '';
      const priceText = ((block.querySelector('.plan-price') || {}).textContent || '');
      const priceMatch = priceText.match(/([\d,]+)\s*(?:JPY|円|日元)/i);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;

      for (const plan of (plans || new Map()).values()) {
        if (title && plan.name && title === plan.name) joined.add(String(plan.id));
        if (price != null && Number(plan.price) === price) joined.add(String(plan.id));
        if ((Number(plan.price) || 0) === 0 && /無料|免费|free/i.test(title)) joined.add(String(plan.id));
      }
    }
    return joined;
  }

  async function detectFantiaUnlockedPlanIds(ownerId, signal, knownPlans) {
    try {
      const html = await requestFantia(`/fanclubs/${ownerId}/plans`, { json: false, signal });
      const joined = parseFantiaJoinedPlanIds(html, knownPlans || state.plans);
      const unlocked = new Set([FREE_PLAN_KEY, ...Array.from(joined).map(String)]);
      return unlocked;
    } catch (error) {
      log(`Fantia 已加入方案检测失败：${error.message}`, 'warn');
      return null;
    }
  }

  async function detectFanboxUnlockedPlanIds(ownerId, signal, creator) {
    const unlocked = new Set([FREE_PLAN_KEY]);
    let supportedFee = null;
    try {
      const data = await requestFanbox('plan.listSupporting', { signal });
      const plans = (data && data.body && data.body.plans) || (data && data.plans) || [];
      const matched = plans.filter((plan) => {
        const creatorId = plan.creatorId
          || (plan.creator && plan.creator.creatorId)
          || (plan.user && plan.user.creatorId)
          || '';
        return String(creatorId) === String(ownerId);
      });
      if (matched.length) {
        supportedFee = Math.max(0, ...matched.map((plan) => Number(plan.fee ?? plan.price) || 0));
      } else if (creator && creator.isSupported === false) {
        supportedFee = 0;
      } else if (creator && creator.isSupported === true) {
        supportedFee = null;
      } else {
        supportedFee = 0;
      }
    } catch (error) {
      log(`Fanbox 赞助方案检测失败：${error.message}`, 'warn');
      if (creator && creator.isSupported === false) supportedFee = 0;
      else return null;
    }

    if (supportedFee == null) return null;
    for (const plan of state.plans.values()) {
      const fee = Number(plan.price) || 0;
      if (fee <= supportedFee) unlocked.add(String(plan.id));
    }
    return unlocked;
  }

  function applyUnlockedPlanSelection(site, ownerId, unlockedIds) {
    if (!unlockedIds) return false;
    const key = planOwnerKey(site, ownerId);
    if (state.planAutoKey === key && state.planManual) return false;

    const unlocked = new Set(Array.from(unlockedIds).map(String));
    unlocked.add(FREE_PLAN_KEY);
    const allIds = [FREE_PLAN_KEY, ...Array.from(state.plans.keys()).map(String)];
    const excluded = allIds.filter((id) => !unlocked.has(id));
    const prev = (settings.excludedPlans || []).map(String).sort().join(',');
    const next = excluded.slice().sort().join(',');
    settings.excludedPlans = excluded;
    state.unlockedPlanIds = unlocked;
    state.planAutoKey = key;
    state.planManual = false;
    if (prev !== next) saveSettings();
    renderPlans();
    applyFilters();

    const selectedLabels = [];
    if (unlocked.has(FREE_PLAN_KEY)) selectedLabels.push('公开内容');
    for (const plan of state.plans.values()) {
      if (unlocked.has(String(plan.id))) selectedLabels.push(plan.name || plan.id);
    }
    state.planAutoTried = key;
    log(`已自动勾选已解锁方案：${selectedLabels.join('、') || '公开内容'}`, 'ok');
    return true;
  }

  function registerPlans(entry) {
    let changed = false;
    for (const plan of entry.plans) {
      if (plan && !state.plans.has(plan.id)) {
        state.plans.set(plan.id, plan);
        changed = true;
      }
    }
    if (changed) renderPlans();
  }

  // ---------- Crawl ----------

  async function crawl() {
    if (state.crawling) return;
    syncTargetWithCurrentPage(true);
    let target = parseTarget(settings.target);
    if (!target) {
      log(`请输入当前 ${siteLabel(PAGE_SITE)} 的作者主页或投稿链接。`, 'bad');
      return;
    }

    let site = targetSite(target);
    maybePreferSiteTemplate(site);
    if (PAGE_SITE !== site) {
      log(`当前页面是 ${siteLabel(PAGE_SITE)}，但目标是 ${siteLabel(site)}。已清空跨站目标，请填写当前站点链接后再抓取。`, 'bad');
      settings.target = targetFromLocation() || '';
      rememberTargetForSite(PAGE_SITE, settings.target);
      saveSettings();
      if (ui) fillForm();
      return;
    }

    const controller = new AbortController();
    state.crawlAbort = controller;
    state.crawling = true;
    state.order = [];
    applyFilters();
    renderButtons();
    clearLog();

    try {
      let cards;
      if (target.postId && settings.scope === 'post') {
        cards = [{ id: target.postId, updatedMs: null }];
        log(`抓取单个${siteLabel(site)}投稿 #${target.postId}`);
        if (site === 'pawchive') {
          rememberPawchivePostHint({
            id: target.postId,
            service: target.service,
            userId: target.userId,
            url: target.service && target.userId
              ? pawchivePostUrl(target.service, target.userId, target.postId)
              : '',
          });
          if (target.creatorId || (target.service && target.userId)) {
            await ensurePlans(target.creatorId || pawchiveOwnerKey(target.service, target.userId), controller.signal, site);
          }
        }
      } else {
        const ownerId = await resolveFanclubId(target, controller.signal);
        await ensurePlans(ownerId, controller.signal, site);
        if (site === 'patreon') {
          await ensurePatreonCollections(ownerId, controller.signal, target.collectionId || '');
        }
        log(`开始读取 ${siteLabel(site)} 作者 ${state.fanclub && state.fanclub.user ? state.fanclub.user : ownerId} 的投稿列表`);
        const fromMs = settings.dateFrom ? dateInputToMs(settings.dateFrom, false) : null;
        const toMs = settings.dateTo ? dateInputToMs(settings.dateTo, true) : null;
        // List APIs are newest-first; stop paging after crossing the lower bound.
        const stopBeforeMs = fromMs == null ? null : (fromMs - DAY);
        const allCards = await listPosts(ownerId, controller.signal, (page, total) => {
          setStatus(`投稿列表第 ${page} 页，已发现 ${total} 个投稿`);
        }, site, { stopBeforeMs });
        cards = allCards.filter((card) => {
          const published = card.publishedMs != null ? card.publishedMs : card.updatedMs;
          if (fromMs != null && published != null && published < fromMs) return false;
          if (toMs != null && published != null && published > toMs) return false;
          // If only updatedMs exists, keep a soft lower bound to avoid missing edited-in-range old posts.
          if (fromMs != null && card.publishedMs == null && card.updatedMs != null && card.updatedMs < fromMs - DAY) return false;
          return true;
        });
        if (site === 'patreon' && target.collectionId) {
          const wanted = String(target.collectionId);
          const before = cards.length;
          cards = cards.filter((card) => collectionIdsForPost(card.id, card.collectionIds || []).includes(wanted));
          // If list endpoint lacks collection relations, fall back to known post_ids.
          if (!cards.length) {
            const known = state.collections.get(wanted);
            if (known && known.postIds && known.postIds.length) {
              cards = known.postIds.map((id) => ({ id: String(id), updatedMs: null, publishedMs: null, collectionIds: [wanted] }));
              log(`列表未带合集关系，改用合集 ${wanted} 的 ${cards.length} 个投稿 ID`);
            }
          } else if (cards.length !== before) {
            log(`已按合集 ${wanted} 预筛：${before} → ${cards.length}`);
          }
        }
        log(`发现 ${allCards.length} 个投稿${allCards.length !== cards.length ? `，按日期/合集预先跳过 ${allCards.length - cards.length} 个` : ''}`);
      }

      for (let i = 0; i < cards.length; i += 1) {
        if (controller.signal.aborted) break;
        const id = cards[i].id;
        setStatus(`正在读取投稿 ${i + 1}/${cards.length}（#${id}）`);
        try {
          const { entry, fresh } = await getPostEntry(id, controller.signal, site);
          state.order.push(entry.meta.id);
          if (fresh && i < cards.length - 1) await sleepAbortable(settings.requestDelay, controller.signal);
          if (i % 3 === 0 || i === cards.length - 1) applyFilters();
        } catch (error) {
          if (controller.signal.aborted) break;
          log(`投稿 #${id} 读取失败：${error.message}`, 'bad');
        }
      }

      applyFilters();
      const result = state.filtered;
      log(controller.signal.aborted ? '抓取已停止，已保留当前结果。' : `抓取完成：${result.posts} 个投稿，${result.items.length} 个文件。`, controller.signal.aborted ? 'warn' : 'ok');
      if (result.locked) log(`有 ${result.locked} 个所选方案内容尚未解锁（未订阅或订阅等级不足），已跳过。`, 'warn');
      if (result.streamOnly) log(`有 ${result.streamOnly} 个内容只提供在线播放，没有下载地址。`, 'warn');
    } catch (error) {
      if (error.name !== 'AbortError') log(`抓取失败：${error.message}`, 'bad');
    } finally {
      state.crawling = false;
      state.crawlAbort = null;
      setStatus(state.filtered.items.length ? `已就绪：${state.filtered.items.length} 个文件` : '没有可下载的文件');
      renderButtons();
    }
  }

  function stopCrawl() {
    if (state.crawlAbort) state.crawlAbort.abort();
  }

  function applyFilters() {
    const entries = state.order.map((id) => state.posts.get(id)).filter(Boolean);
    state.filtered = filterEntries(entries, settings);
    renderSummary();
    schedulePreview();
    renderBadge();
  }

  // ---------- Downloads ----------

  function startDownload() {
    if (typeof GM_download !== 'function') {
      log('当前脚本管理器不支持 GM_download，请使用 Tampermonkey。', 'bad');
      return;
    }
    if (state.crawling) return;
    const all = state.filtered.items.slice();
    if (!all.length) {
      log('没有可下载的文件，请先抓取或调整筛选条件。', 'warn');
      return;
    }
    const queue = all.filter((item) => !(settings.skipDownloaded && state.history.has(item.key)));
    state.dl = {
      running: true,
      paused: false,
      queue: queue.map((item) => ({ item, attempts: 0 })),
      active: new Map(),
      done: 0,
      skipped: all.length - queue.length,
      failed: [],
      total: all.length,
      startedAt: Date.now(),
    };
    log(`开始下载 ${queue.length} 个文件${state.dl.skipped ? `，跳过 ${state.dl.skipped} 个已下载文件` : ''}`);
    switchTab('download');
    pump();
  }

  function pump() {
    const dl = state.dl;
    if (!dl || !dl.running) return;
    if (!dl.paused) {
      const limit = Math.min(Math.max(Number(settings.concurrency) || 1, 1), 6);
      while (dl.active.size < limit && dl.queue.length) launch(dl.queue.shift());
    }
    if (!dl.active.size && !dl.queue.length) {
      dl.running = false;
      const seconds = Math.round((Date.now() - dl.startedAt) / 1000);
      log(`下载结束：成功 ${dl.done}，失败 ${dl.failed.length}，跳过 ${dl.skipped}，用时 ${seconds} 秒。`, dl.failed.length ? 'warn' : 'ok');
      setStatus(dl.failed.length ? `下载结束，有 ${dl.failed.length} 个失败` : '全部下载完成');
    }
    renderButtons();
    scheduleProgress();
  }

  function textDataUrl(text) {
    return `data:text/plain;charset=utf-8,${encodeURIComponent(`\ufeff${text || ''}`)}`;
  }

  function describeDownloadError(error) {
    const code = error && (error.error || error.message || error);
    const hints = {
      not_whitelisted: '扩展名未加入 Tampermonkey 下载白名单',
      not_enabled: 'Tampermonkey 未启用下载功能',
      not_permitted: '浏览器未授予下载权限',
      not_supported: '当前下载模式不支持此操作',
      not_succeeded: '下载未成功，链接可能已过期或网络中断',
      timeout: '下载超时',
    };
    const detail = error && error.details ? `（${typeof error.details === 'string' ? error.details : JSON.stringify(error.details)}）` : '';
    return `${hints[code] || code || '未知错误'}${detail}`;
  }

  function launch(task) {
    const dl = state.dl;
    const item = task.item;
    const name = buildPath(item, settings);
    const active = { task, name, loaded: 0, total: item.size || 0, handle: null };
    dl.active.set(item.key, active);
    task.attempts += 1;

    const finish = (ok, error) => {
      if (state.dl !== dl || !dl.active.has(item.key)) return;
      dl.active.delete(item.key);
      if (ok) {
        dl.done += 1;
        state.history.add(item.key);
        saveHistory();
      } else {
        const code = error && error.error;
        const permanent = ['not_whitelisted', 'not_enabled', 'not_permitted', 'not_supported'].includes(code);
        if (!permanent && task.attempts < 3 && dl.running) {
          dl.queue.push(task);
        } else {
          dl.failed.push({ task, name, reason: describeDownloadError(error) });
          log(`下载失败：${name} — ${describeDownloadError(error)}`, 'bad');
        }
      }
      setTimeout(pump, 0);
    };

    try {
      active.handle = GM_download({
        url: (item.kind === 'text' || item.kind === 'link') ? textDataUrl(item.text) : item.url,
        name,
        saveAs: false,
        conflictAction: 'uniquify',
        onprogress: (event) => {
          active.loaded = event.loaded || 0;
          active.total = event.total || active.total;
          scheduleProgress();
        },
        onload: () => finish(true),
        onerror: (error) => finish(false, error),
        ontimeout: () => finish(false, { error: 'timeout' }),
      });
    } catch (error) {
      finish(false, { error: error.message });
    }
  }

  function togglePause() {
    const dl = state.dl;
    if (!dl || !dl.running) return;
    dl.paused = !dl.paused;
    log(dl.paused ? '已暂停：正在进行的文件会继续完成。' : '继续下载。', 'warn');
    pump();
  }

  function stopDownload() {
    const dl = state.dl;
    if (!dl || !dl.running) return;
    dl.running = false;
    for (const active of dl.active.values()) {
      try {
        if (active.handle && typeof active.handle.abort === 'function') active.handle.abort();
      } catch (_) { /* ignore */ }
    }
    dl.active.clear();
    dl.queue = [];
    log('下载已停止。', 'warn');
    setStatus('下载已停止');
    renderButtons();
    scheduleProgress();
  }

  function retryFailed() {
    const dl = state.dl;
    if (!dl || dl.running || !dl.failed.length) return;
    const tasks = dl.failed.map((failure) => ({ item: failure.task.item, attempts: 0 }));
    dl.failed = [];
    dl.queue = tasks;
    dl.running = true;
    dl.paused = false;
    dl.startedAt = Date.now();
    log(`重试 ${tasks.length} 个失败文件。若仍失败，请重新抓取以刷新下载链接。`);
    pump();
  }

  // ---------- UI ----------

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .fdl {
      --accent: #92d864;
      --accent-deep: #5ea63a;
      --accent-soft: #e9f8dc;
      --apricot: #c7ef9e;
      --shadow-rgb: 146, 216, 100;
      --ink: #2a1c21;
      --muted: #806d73;
      --line: #efdfe2;
      --paper: #fffaf7;
      --card: #ffffff;
      --ok: #138a60;
      --warn: #b86b00;
      --bad: #c93434;
      color: var(--ink);
      font: 13px/1.55 "Zen Kaku Gothic New", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif;
    }
    button, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    .launcher {
      position: fixed !important;
      right: var(--launcher-right, 24px) !important;
      top: var(--launcher-top, auto) !important;
      bottom: auto !important;
      left: auto !important;
      z-index: 2147483645;
      width: 56px; height: 56px; min-height: 56px; padding: 0; border: 0;
      border-radius: 18px; display: inline-grid; place-items: center; gap: 0;
      color: #fff; background: var(--ink);
      font: 900 28px/1 "Zen Kaku Gothic New", "Hiragino Sans", "Microsoft YaHei UI", sans-serif;
      box-shadow: 5px 5px 0 var(--accent);
      transition: transform .18s ease, box-shadow .18s ease, background .15s ease;
      overflow: visible;
      margin: 0 !important;
      inset: auto var(--launcher-right, 24px) auto auto !important;
      top: var(--launcher-top, calc(100vh - 80px)) !important;
    }
    .launcher:hover {
      transform: translateY(-2px);
      box-shadow: 7px 7px 0 var(--accent);
      background: #3a2830;
    }
    .launcher-mark {
      display: block; pointer-events: none; user-select: none;
      transform: translateY(-1px);
    }
    .badge {
      position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px;
      border: 2px solid #fff; border-radius: 99px; display: grid; place-items: center;
      color: var(--accent-deep); background: #fff3c4; font-size: 11px; font-weight: 800;
    }
    .overlay {
      position: fixed; inset: 0; z-index: 2147483646; display: none;
      background: rgba(42, 28, 33, .36); backdrop-filter: blur(3px);
    }
    .panel {
      position: fixed; top: 50%; left: 50%; z-index: 2147483647;
      width: min(780px, calc(100vw - 24px)); max-height: min(90vh, 920px);
      display: none; flex-direction: column; overflow: hidden;
      transform: translate(-50%, -50%);
      border: 1px solid rgba(255,255,255,.7); border-radius: 22px;
      background: var(--paper);
      box-shadow: 0 32px 90px rgba(42, 28, 33, .34);
    }
    .fdl.open .overlay { display: block; animation: fade .2s ease both; }
    .fdl.open .panel { display: flex; animation: panelIn .34s cubic-bezier(.2,.9,.25,1.12) both; }
    .head {
      position: relative; padding: 18px 22px 0; border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .head-top { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark {
      flex: 0 0 auto; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center;
      color: #fff; background: var(--ink); font: 900 22px/1 "Zen Kaku Gothic New", "Hiragino Sans", "Microsoft YaHei UI", sans-serif;
      box-shadow: 5px 5px 0 var(--accent);
    }
    .title { font-size: 20px; font-weight: 900; letter-spacing: .02em; }
    .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .icon-btn { width: 36px; height: 36px; border: 0; border-radius: 12px; background: rgba(42,28,33,.06); font-size: 24px; line-height: 1; }
    .icon-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tabs { display: flex; gap: 6px; margin-top: 14px; overflow: hidden; flex-wrap: wrap; }
    .tab { position: relative; padding: 9px 15px 11px; border: 0; background: transparent; color: var(--muted); font-weight: 800; white-space: nowrap; }
    .tab::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--accent); transform: scaleX(0); transition: transform .2s ease; }
    .tab.active { color: var(--ink); }
    .tab.active::after { transform: scaleX(1); }
    .body { min-height: 0; overflow: auto; padding: 4px 22px 18px; }
    .pane { display: none; }
    .pane.active { display: block; }
    .row {
      display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 14px; align-items: start;
      padding: 13px 0; border-bottom: 1px dashed var(--line);
      animation: rise .38s ease both; animation-delay: calc(var(--i, 0) * 38ms);
    }
    .label { padding-top: 7px; font-weight: 800; }
    .row > * { min-width: 0; }
    .label small { display: block; color: var(--muted); font-weight: 500; font-size: 11px; }
    .input, .date, .number {
      width: 100%; min-height: 36px; padding: 7px 10px; border: 1px solid #e5cfd4; border-radius: 10px;
      outline: none; background: #fff; transition: border-color .15s, box-shadow .15s;
    }
    .input:focus, .date:focus, .number:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--shadow-rgb), .16); }
    .date { width: auto; min-width: 150px; }
    .row.is-disabled { opacity: .45; }
    .row.is-disabled .input,
    .row.is-disabled .date,
    .row.is-disabled .mini {
      cursor: not-allowed;
      pointer-events: none;
    }
    .date:disabled,
    .input:disabled,
    .row.is-disabled .date,
    .row.is-disabled .input {
      background: #efe6e9;
      color: #8f7f84;
      border-color: #e2d2d7;
    }
    .number { width: 110px; }
    .mono { font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace; }
    .inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .hint { margin-top: 6px; color: var(--muted); font-size: 11.5px; }
    .chips, .vars, .quick { display: flex; flex-wrap: wrap; gap: 7px; }
    .quick { margin-top: 8px; }
    .chip { position: relative; display: inline-flex; }
    .chip input { position: absolute; opacity: 0; pointer-events: none; }
    .chip span, .mini, .var {
      display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 11px;
      border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted);
      transition: background .15s, color .15s, border-color .15s, transform .15s;
    }
    .chip span::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #e6d5d9; }
    .chip input:checked + span { border-color: color-mix(in srgb, var(--accent) 42%, white); background: var(--accent-soft); color: var(--accent-deep); font-weight: 800; }
    .chip input:checked + span::before { background: var(--accent); box-shadow: 0 0 0 3px rgba(var(--shadow-rgb), .16); }
    .chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chip:hover span, .mini:hover, .var:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 45%, white); }
    .mini { border-radius: 9px; font-size: 12px; }
    .var { border-radius: 8px; border-style: dashed; font-size: 12px; }
    .var code { color: var(--accent-deep); font: 700 12px "Cascadia Code", Consolas, monospace; }
    .seg { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding: 4px; border-radius: 12px; background: var(--accent-soft); }
    .seg label { display: inline-flex; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg span { padding: 5px 10px; border-radius: 9px; color: var(--muted); }
    .seg input:checked + span { background: #fff; color: var(--accent-deep); font-weight: 800; box-shadow: 0 2px 7px rgba(42,28,33,.08); }
    .check { display: inline-flex; align-items: center; gap: 8px; margin-left: 18px; }
    .check input { accent-color: var(--accent); width: 16px; height: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; padding: 16px 0 12px; animation: rise .38s ease both; animation-delay: 260ms; }
    .btn { min-height: 39px; padding: 8px 17px; border: 1px solid transparent; border-radius: 12px; font-weight: 900; transition: transform .15s, box-shadow .15s, background .15s; }
    .btn:not(:disabled):hover { transform: translateY(-1px); }
    .primary { color: #fff; background: var(--accent); box-shadow: 0 9px 18px rgba(var(--shadow-rgb), .24); }
    .dark { color: #fff; background: var(--ink); box-shadow: 4px 4px 0 var(--accent); }
    #fdl-go-download { box-shadow: none; }
    .ghost { border-color: var(--line); background: #fff; }
    .danger { color: var(--bad); border-color: #f0c8c8; background: #fff; }
    .summary {
      margin-top: 2px; padding: 14px; border: 1px solid var(--line); border-radius: 16px;
      background: #fff;
    }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
    .stat { padding: 10px; border-radius: 12px; background: #fff; border: 1px solid #f4e6e8; }
    .stat b { display: block; font: 900 21px/1.1 "Zen Kaku Gothic New", "Hiragino Sans", "Microsoft YaHei UI", sans-serif; }
    .stat span { color: var(--muted); font-size: 11.5px; }
    .empty { color: var(--muted); text-align: center; padding: 10px; }
    .notice { margin-top: 10px; color: var(--warn); font-size: 12px; }
    .log, .preview, .fail-list {
      max-height: 170px; overflow: auto; margin-top: 12px; padding: 10px 12px; border-radius: 13px;
      color: #f9edf0; background: #2a1c21; font: 11.5px/1.65 "Cascadia Code", Consolas, monospace;
    }
    .log:empty { display: none; }
    .log .ok { color: #7ee0b2; }
    .log .warn { color: #ffd479; }
    .log .bad { color: #ff9a9a; }
    .preview { max-height: 205px; margin-top: 0; color: #ffeef2; }
    .preview div { white-space: nowrap; }
    .preview i { display: inline-block; min-width: 34px; color: var(--apricot); font-style: normal; }
    .progress { height: 12px; overflow: hidden; border-radius: 99px; background: #f2e2e5; }
    .bar { width: 0%; height: 100%; border-radius: inherit; background: var(--accent); transition: width .25s ease; }
    .dl-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--muted); }
    .active-list { display: grid; gap: 7px; margin-top: 10px; }
    .job { padding: 8px 10px; border: 1px solid var(--line); border-radius: 11px; background: #fff; }
    .job-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .job-bar { height: 4px; margin-top: 5px; border-radius: 9px; background: #f2e2e5; overflow: hidden; }
    .job-bar div { height: 100%; background: var(--accent); }
    .fail-list { color: #ffcaca; }
    .fail-list:empty { display: none; }
    .foot {
      display: flex; align-items: center; gap: 10px; padding: 11px 22px; border-top: 1px solid var(--line);
      background: rgba(255,255,255,.75); color: var(--muted); font-size: 12px;
    }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px rgba(19,138,96,.12); }
    .busy .pulse { background: var(--accent); animation: pulse 1s ease-in-out infinite; }
    .tips { margin: 0; padding-left: 18px; color: var(--muted); }
    .tips li { margin: 5px 0; }
    .tips b { color: var(--ink); }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes panelIn { from { opacity: 0; transform: translate(-50%, -46%) scale(.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    @keyframes sheetIn { from { opacity: .6; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes launcherIn { from { opacity: 0; transform: translateY(20px) scale(.7) rotate(12deg); } to { opacity: 1; transform: none; } }
    @keyframes pulse { 50% { transform: scale(.65); opacity: .55; } }
    @media (max-width: 640px) {
      .launcher { right: var(--launcher-right, 16px) !important; top: var(--launcher-top, calc(100vh - 72px)) !important; bottom: auto !important; left: auto !important; }
      .panel { top: auto; left: 0; bottom: 0; width: 100vw; max-height: 92vh; transform: none; border-radius: 22px 22px 0 0; }
      .fdl.open .panel { animation-name: sheetIn; }
      .head { padding: 15px 15px 0; }
      .body { padding: 2px 15px 16px; }
      .foot { padding: 10px 15px; }
      .row { grid-template-columns: minmax(0, 1fr); gap: 7px; }
      .label { padding-top: 0; }
      .two, .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .var { max-width: 100%; }
      .date { flex: 1 1 130px; min-width: 0; }
      .check { margin: 8px 0 0; display: flex; }
      .btn { flex: 1 1 auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  `;

  const HTML = `
    <div class="fdl" id="fdl">
      <button class="launcher" id="fdl-launch" type="button" title="使用 FanLoot 抓取" aria-label="使用 FanLoot 抓取"><span class="launcher-mark">F</span><span class="badge" id="fdl-badge" hidden></span></button>
      <div class="overlay" id="fdl-overlay"></div>
      <section class="panel" role="dialog" aria-modal="true" aria-label="FanLoot">
        <header class="head">
          <div class="head-top">
            <div class="brand">
              <div class="mark">F</div>
              <div style="min-width:0">
                <div class="title">FanLoot</div>
                <div class="sub" id="fdl-sub">打开 Fantia / Fanbox / Patreon 作者主页或投稿页即可开始</div>
              </div>
            </div>
            <button class="icon-btn" id="fdl-close" type="button" aria-label="关闭">×</button>
          </div>
          <nav class="tabs">
            <button class="tab active" type="button" data-tab="crawl">① 抓取筛选</button>
            <button class="tab" type="button" data-tab="download">② 文件名与下载</button>
            <button class="tab" type="button" data-tab="more">更多</button>
          </nav>
        </header>

        <div class="body">
          <div class="pane active" data-pane="crawl">
            <div class="row">
              <div class="label">抓取目标<small>作者 / 投稿</small></div>
              <div>
                <input class="input" id="fdl-target" placeholder="Fantia / Fanbox / Patreon 作者主页或投稿链接">
                <div class="hint" id="fdl-target-info">支持 Fantia / Fanbox / Patreon 作者主页、投稿链接，以及 Patreon 合集链接。</div>
                <div class="seg" id="fdl-scope" hidden>
                  <label><input type="radio" name="fdl-scope" value="fanclub"><span>该作者全部投稿</span></label>
                  <label><input type="radio" name="fdl-scope" value="post"><span>仅当前投稿</span></label>
                </div>
              </div>
            </div>
            <div class="row">
              <div class="label">投稿日期<small>JST，含起止日</small></div>
              <div id="fdl-date-controls">
                <div class="inline">
                  <input class="date" id="fdl-from" type="date" aria-label="开始日期">
                  <span>至</span>
                  <input class="date" id="fdl-to" type="date" aria-label="结束日期">
                </div>
                <div class="quick">
                  <button class="mini" type="button" data-quick="30">近 30 天</button>
                  <button class="mini" type="button" data-quick="90">近 90 天</button>
                  <button class="mini" type="button" data-quick="year">今年</button>
                  <button class="mini" type="button" data-quick="clear">不限</button>
                </div>
                <div class="hint" id="fdl-date-hint" hidden>已选择“仅当前投稿”，不按投稿日期筛选。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">标题关键词<small>可选</small></div>
              <div class="two">
                <input class="input" id="fdl-keyword" placeholder="包含任一关键词">
                <input class="input" id="fdl-exclude" placeholder="排除关键词">
              </div>
            </div>
            <div class="row">
              <div class="label">限定方案<small>内容区块</small></div>
              <div>
                <div class="chips" id="fdl-plans"></div>
                <div class="quick">
                  <button class="mini" type="button" data-plans="all">全选方案</button>
                  <button class="mini" type="button" data-plans="none">全不选</button>
                </div>
                <div class="hint">只能下载你当前账号已解锁的内容；未解锁内容会单独计数。</div>
              </div>
            </div>
            <div class="row" id="fdl-collections-row" hidden>
              <div class="label">限定合集<small>Patreon</small></div>
              <div>
                <div class="chips" id="fdl-collections"></div>
                <div class="quick">
                  <button class="mini" type="button" data-collections="all">全选合集</button>
                  <button class="mini" type="button" data-collections="none">全不选</button>
                </div>
                <div class="hint">可按合集筛选投稿；未归入任何合集的投稿对应“未合集”。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">文件类型</div>
              <div class="chips" id="fdl-types"></div>
            </div>
            <div class="row">
              <div class="label">请求间隔</div>
              <div class="inline">
                <input class="number" id="fdl-delay" type="number" min="200" max="10000" step="100">
                <span class="hint" style="margin:0">毫秒。作品很多时建议 600 以上，降低被限流概率。</span>
              </div>
            </div>
            <div class="actions">
              <button class="btn primary" id="fdl-crawl" type="button">开始抓取</button>
              <button class="btn ghost" id="fdl-crawl-stop" type="button">停止抓取</button>
              <button class="btn dark" id="fdl-go-download" type="button" disabled>下一步</button>
            </div>
            <div class="summary" id="fdl-summary"></div>
            <div class="log" id="fdl-log"></div>
          </div>

          <div class="pane" data-pane="download">
            <div class="row">
              <div class="label">文件名规则<small>用 / 建文件夹</small></div>
              <div>
                <input class="input mono" id="fdl-template" spellcheck="false">
                <div class="vars" id="fdl-vars" style="margin-top:9px"></div>
                <div class="hint">点击变量可插入到光标处。未使用 {ext} 时会自动补扩展名；路径相对于浏览器默认下载目录。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">日期格式<small>用于 {date}</small></div>
              <div>
                <input class="input mono" id="fdl-date-format" spellcheck="false" style="max-width:260px">
                <div class="hint">可用 YYYY、YY、MM、DD、HH、mm、ss，例如 YYYYMMDD 或 YYYY-MM-DD_HH-mm。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">命名预览</div>
              <div class="preview" id="fdl-preview"></div>
            </div>
            <div class="row">
              <div class="label">下载设置</div>
              <div class="inline">
                <span>同时下载</span>
                <input class="number" id="fdl-concurrency" type="number" min="1" max="6" step="1">
                <label class="check"><input type="checkbox" id="fdl-skip">跳过已下载过的文件</label>
              </div>
            </div>
            <div class="actions">
              <button class="btn primary" id="fdl-download" type="button">开始下载</button>
              <button class="btn ghost" id="fdl-pause" type="button">暂停</button>
              <button class="btn danger" id="fdl-stop" type="button">停止</button>
              <button class="btn ghost" id="fdl-retry" type="button">重试失败</button>
              <button class="btn danger" id="fdl-clear-history-dl" type="button">清除记录</button>
            </div>
            <div class="progress"><div class="bar" id="fdl-bar"></div></div>
            <div class="dl-meta" id="fdl-dl-meta"><span>尚未开始下载</span></div>
            <div class="active-list" id="fdl-active"></div>
            <div class="fail-list" id="fdl-failed"></div>
          </div>

          <div class="pane" data-pane="more">
            <div class="row">
              <div class="label">导出</div>
              <div>
                <button class="btn ghost" id="fdl-copy" type="button">复制当前筛选结果的链接</button>
                <div class="hint">每行格式：URL + Tab + 预计保存路径。Fantia / Fanbox / Patreon / Pawchive 的直链都可能有时效，Fantia / Fanbox / Patreon 通常还需要保持登录状态。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">下载记录</div>
              <div>
                <div class="inline">
                  <span id="fdl-history-count"></span>
                  <button class="btn danger" id="fdl-clear-history" type="button">清除记录</button>
                </div>
                <div class="hint">记录用于“跳过已下载过的文件”，按 投稿 ID + 文件 ID 识别。</div>
              </div>
            </div>
            <div class="row">
              <div class="label">使用提示</div>
              <ul class="tips">
                <li>推荐 <b>Tampermonkey</b>。如需按文件夹保存，请在 Tampermonkey 设置的“下载 BETA”中选择 <b>浏览器 API</b>。</li>
                <li>视频或压缩包下载失败并提示白名单时，请在“下载 BETA → 白名单扩展名”中添加对应扩展名，或使用 <b>/.*/</b>。</li>
                <li>浏览器若每个文件都弹出“另存为”，请关闭浏览器设置中的“下载前询问每个文件的保存位置”。</li>
                <li>请在对应网站打开本面板后再抓取：Fantia、Fanbox、Patreon、Pawchive 互相不能跨站代抓。</li>
                <li>Fantia / Fanbox / Patreon 的下载链接常有时效，失败较多时请重新抓取；Pawchive 多为站点直链，一般更稳定。</li>
                <li>Patreon 支持按订阅方案与合集筛选；Fanbox / Fantia 主要按订阅方案筛选；Pawchive 无方案概念，按页面可见内容抓取。</li>
                <li>正文/卡片里的网盘链接可汇总导出。Fanbox 与 Pawchive 的 iframely 卡片会尽量自动还原为真实网盘地址。</li>
              </ul>
            </div>
          </div>
        </div>
        <footer class="foot" id="fdl-foot"><span class="pulse"></span><span id="fdl-status">准备就绪</span></footer>
      </section>
    </div>
  `;


  function isVisibleFixed(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    if (!(style.position === 'fixed' || style.position === 'sticky')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 24 && rect.height > 24 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  }

  function updateLauncherAvoidance() {
    if (!ui || !ui.root) return;
    const launcher = ui.$('fdl-launch');
    const shell = ui.root.querySelector('.fdl');
    const host = document.getElementById('fanloot-downloader');
    if (!launcher || !shell) return;

    const base = window.matchMedia('(max-width: 640px)').matches ? 16 : 24;
    const gap = 12;
    const launcherHeight = Math.max(launcher.offsetHeight || 56, 48);
    const launcherWidth = Math.max(launcher.offsetWidth || 56, 48);
    // Keep the button in the lower-right corner. Only lift a little for compact
    // bottom-right widgets; never let avoidance throw it to the top.
    const maxLift = Math.min(120, Math.floor(window.innerHeight * 0.18));
    let lift = 0;

    const rightEdge = window.innerWidth - base;
    const leftEdge = Math.max(0, rightEdge - launcherWidth - 28);
    const nodes = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of nodes) {
      if (!el || el === host || (host && host.contains(el))) continue;
      if (!isVisibleFixed(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > 140 || rect.width > 360) continue;
      if (rect.top < window.innerHeight - 220) continue;
      const overlapsX = rect.left < rightEdge && rect.right > leftEdge;
      const nearBottom = rect.bottom > window.innerHeight - 150 && rect.bottom <= window.innerHeight + 8;
      if (!overlapsX || !nearBottom) continue;
      const needed = Math.ceil((window.innerHeight - rect.top) + gap - base);
      if (needed > lift) lift = needed;
    }

    lift = Math.max(0, Math.min(lift, maxLift));
    const top = Math.max(base, window.innerHeight - base - launcherHeight - lift);
    shell.style.setProperty('--launcher-right', `${base}px`);
    shell.style.setProperty('--launcher-top', `${top}px`);

    // Hard-pin with viewport coordinates so host/page CSS cannot drag it away.
    const pin = (node) => {
      if (!node) return;
      node.style.setProperty('position', 'fixed', 'important');
      node.style.setProperty('right', `${base}px`, 'important');
      node.style.setProperty('top', `${top}px`, 'important');
      node.style.setProperty('bottom', 'auto', 'important');
      node.style.setProperty('left', 'auto', 'important');
      node.style.setProperty('margin', '0', 'important');
      node.style.setProperty('transform', 'none', 'important');
      node.style.setProperty('inset', `auto ${base}px auto auto`, 'important');
      node.style.setProperty('top', `${top}px`, 'important');
    };
    pin(launcher);
    if (host) {
      host.style.setProperty('position', 'static', 'important');
      host.style.setProperty('transform', 'none', 'important');
      host.style.setProperty('filter', 'none', 'important');
      host.style.setProperty('perspective', 'none', 'important');
      host.style.setProperty('contain', 'none', 'important');
    }
  }

  function scheduleLauncherAvoidance() {
    if (!ui) return;
    if (ui.launcherAvoidTimer) clearTimeout(ui.launcherAvoidTimer);
    ui.launcherAvoidTimer = setTimeout(() => {
      ui.launcherAvoidTimer = 0;
      updateLauncherAvoidance();
    }, 80);
  }

  function startLauncherAvoidance() {
    if (!ui || ui.launcherAvoidStarted) return;
    ui.launcherAvoidStarted = true;
    updateLauncherAvoidance();
    window.addEventListener('resize', scheduleLauncherAvoidance, { passive: true });
    window.addEventListener('scroll', scheduleLauncherAvoidance, { passive: true });
    if (typeof MutationObserver === 'function' && document.body) {
      ui.launcherAvoidObserver = new MutationObserver(scheduleLauncherAvoidance);
      ui.launcherAvoidObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    setTimeout(updateLauncherAvoidance, 400);
    setTimeout(updateLauncherAvoidance, 1200);
  }

  function mountUI() {
    const host = document.createElement('div');
    host.id = 'fanloot-downloader';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    document.documentElement.appendChild(host);
    applyTheme(PAGE_SITE);
    const $ = (id) => root.querySelector(`#${id}`);
    ui = { root, $ };
    ui.launcherAvoidTimer = 0;
    ui.launcherAvoidObserver = null;
    ui.launcherAvoidStarted = false;
    startLauncherAvoidance();

    root.querySelectorAll('.pane').forEach((pane) => {
      pane.querySelectorAll('.row').forEach((row, i) => row.style.setProperty('--i', String(i)));
    });

    $('fdl-types').innerHTML = TYPE_ORDER.map((type) => `
      <label class="chip"><input type="checkbox" data-type="${type}"><span>${TYPE_LABELS[type]}</span></label>
    `).join('');
    $('fdl-vars').innerHTML = VARIABLES.map(([token, label]) => `
      <button class="var" type="button" data-var="${token}" title="${escapeHtml(label)}"><code>${token}</code>${escapeHtml(label)}</button>
    `).join('');

    syncTargetWithCurrentPage(true);
    fillForm();
    bindEvents();
    renderPlans();
    renderCollections();
    renderSummary();
    renderButtons();
    renderHistory();
    schedulePreview();
    scheduleProgress();
  }

  function fillForm() {
    const $ = ui.$;
    $('fdl-target').value = settings.target;
    $('fdl-from').value = settings.dateFrom;
    $('fdl-to').value = settings.dateTo;
    $('fdl-keyword').value = settings.keyword;
    $('fdl-exclude').value = settings.excludeKeyword;
    $('fdl-delay').value = settings.requestDelay;
    $('fdl-template').value = settings.template;
    $('fdl-date-format').value = settings.dateFormat;
    $('fdl-concurrency').value = settings.concurrency;
    $('fdl-skip').checked = settings.skipDownloaded;
    ui.root.querySelectorAll('[data-type]').forEach((input) => {
      input.checked = !!settings.types[input.dataset.type];
    });
    ui.root.querySelectorAll('input[name="fdl-scope"]').forEach((input) => {
      input.checked = input.value === settings.scope;
    });
    renderScope();
    renderDateControls();
  }

  function bindEvents() {
    const { root, $ } = ui;
    $('fdl-launch').addEventListener('click', openPanel);
    $('fdl-close').addEventListener('click', closePanel);
    $('fdl-overlay').addEventListener('click', closePanel);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePanel();
    });
    root.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

    $('fdl-target').addEventListener('input', () => {
      settings.target = $('fdl-target').value.trim();
      rememberTargetForSite(PAGE_SITE, settings.target);
      saveSettings();
      renderScope();
      clearTimeout(targetTimer);
      targetTimer = setTimeout(refreshTarget, 650);
    });
    root.querySelectorAll('input[name="fdl-scope"]').forEach((input) => input.addEventListener('change', () => {
      settings.scope = input.value;
      saveSettings();
      renderDateControls();
      applyFilters();
    }));

    const bindFilter = (id, key) => $(id).addEventListener('input', () => {
      settings[key] = $(id).value;
      saveSettings();
      applyFilters();
    });
    bindFilter('fdl-from', 'dateFrom');
    bindFilter('fdl-to', 'dateTo');
    bindFilter('fdl-keyword', 'keyword');
    bindFilter('fdl-exclude', 'excludeKeyword');

    root.querySelectorAll('[data-quick]').forEach((button) => button.addEventListener('click', () => {
      if (settings.scope === 'post') return;
      const value = button.dataset.quick;
      const today = formatDate(Date.now(), 'YYYY-MM-DD');
      if (value === 'clear') {
        settings.dateFrom = '';
        settings.dateTo = '';
      } else if (value === 'year') {
        settings.dateFrom = `${today.slice(0, 4)}-01-01`;
        settings.dateTo = '';
      } else {
        settings.dateFrom = formatDate(Date.now() - Number(value) * DAY, 'YYYY-MM-DD');
        settings.dateTo = '';
      }
      $('fdl-from').value = settings.dateFrom;
      $('fdl-to').value = settings.dateTo;
      saveSettings();
      applyFilters();
    }));

    $('fdl-types').addEventListener('change', (event) => {
      const input = event.target.closest('[data-type]');
      if (!input) return;
      settings.types[input.dataset.type] = input.checked;
      saveSettings();
      applyFilters();
    });
    $('fdl-plans').addEventListener('change', (event) => {
      const input = event.target.closest('[data-plan]');
      if (!input) return;
      const excluded = new Set(settings.excludedPlans);
      if (input.checked) excluded.delete(input.dataset.plan);
      else excluded.add(input.dataset.plan);
      settings.excludedPlans = Array.from(excluded);
      markPlanSelectionManual();
      saveSettings();
      applyFilters();
    });
    root.querySelectorAll('[data-plans]').forEach((button) => button.addEventListener('click', () => {
      settings.excludedPlans = button.dataset.plans === 'all'
        ? []
        : [FREE_PLAN_KEY, ...Array.from(state.plans.keys())];
      markPlanSelectionManual();
      saveSettings();
      renderPlans();
      applyFilters();
    }));
    $('fdl-collections').addEventListener('change', (event) => {
      const input = event.target.closest('[data-collection]');
      if (!input) return;
      const excluded = new Set(settings.excludedCollections);
      if (input.checked) excluded.delete(input.dataset.collection);
      else excluded.add(input.dataset.collection);
      settings.excludedCollections = Array.from(excluded);
      state.collectionManual = true;
      saveSettings();
      applyFilters();
    });
    root.querySelectorAll('[data-collections]').forEach((button) => button.addEventListener('click', () => {
      settings.excludedCollections = button.dataset.collections === 'all'
        ? []
        : [COLLECTION_NONE_KEY, ...Array.from(state.collections.keys())];
      state.collectionManual = true;
      saveSettings();
      renderCollections();
      applyFilters();
    }));

    $('fdl-delay').addEventListener('change', () => {
      settings.requestDelay = Math.min(Math.max(Number($('fdl-delay').value) || DEFAULT_SETTINGS.requestDelay, 200), 10000);
      $('fdl-delay').value = settings.requestDelay;
      saveSettings();
    });
    $('fdl-template').addEventListener('input', () => {
      settings.template = $('fdl-template').value;
      saveSettings();
      schedulePreview();
    });
    $('fdl-date-format').addEventListener('input', () => {
      settings.dateFormat = $('fdl-date-format').value || DEFAULT_SETTINGS.dateFormat;
      saveSettings();
      schedulePreview();
    });
    $('fdl-vars').addEventListener('click', (event) => {
      const button = event.target.closest('[data-var]');
      if (button) insertVariable(button.dataset.var);
    });
    $('fdl-concurrency').addEventListener('change', () => {
      settings.concurrency = Math.min(Math.max(Number($('fdl-concurrency').value) || 1, 1), 6);
      $('fdl-concurrency').value = settings.concurrency;
      saveSettings();
      pump();
    });
    $('fdl-skip').addEventListener('change', () => {
      settings.skipDownloaded = $('fdl-skip').checked;
      saveSettings();
    });

    $('fdl-crawl').addEventListener('click', crawl);
    $('fdl-crawl-stop').addEventListener('click', stopCrawl);
    $('fdl-go-download').addEventListener('click', () => switchTab('download'));
    $('fdl-download').addEventListener('click', startDownload);
    $('fdl-pause').addEventListener('click', togglePause);
    $('fdl-stop').addEventListener('click', stopDownload);
    $('fdl-retry').addEventListener('click', retryFailed);
    $('fdl-copy').addEventListener('click', copyLinks);
    const clearHistory = () => {
      if (!state.history.size) {
        log('当前没有可清除的下载记录。');
        return;
      }
      if (!confirm(`确定清除 ${state.history.size} 条下载记录吗？`)) return;
      state.history.clear();
      gmSet(HISTORY_KEY, []);
      renderHistory();
      applyFilters();
      log('下载记录已清除。', 'ok');
    };
    $('fdl-clear-history').addEventListener('click', clearHistory);
    const clearDl = $('fdl-clear-history-dl');
    if (clearDl) clearDl.addEventListener('click', clearHistory);
  }

  function insertVariable(token) {
    const input = ui.$('fdl-template');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    settings.template = input.value;
    saveSettings();
    schedulePreview();
  }

  function extractFanboxCreatorFromDom() {
    const attrs = [];
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href) attrs.push(canonical.href);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && (ogUrl.content || ogUrl.getAttribute('content'))) attrs.push(ogUrl.content || ogUrl.getAttribute('content'));
    for (const a of Array.from(document.querySelectorAll('a[href*="fanbox.cc/@"], a[href^="/@"]')).slice(0, 40)) {
      if (a.href) attrs.push(a.href);
    }
    for (const value of attrs) {
      const match = String(value).match(/(?:www\.)?fanbox\.cc\/@([a-z0-9_-]+)/i) || String(value).match(/\/@([a-z0-9_-]+)/i);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  function targetFromLocation() {
    const href = String(location.href || '');
    const site = detectSite(href) || PAGE_SITE;
    if (site === 'pawchive') {
      const parsed = parsePawchiveTarget(href) || parsePawchiveTarget(location.pathname + location.search);
      if (!parsed) return '';
      if (parsed.postId) return pawchivePostUrl(parsed.service, parsed.userId, parsed.postId);
      return pawchiveUserUrl(parsed.service, parsed.userId);
    }
    if (site === 'patreon') {
      if (!parsePatreonTarget(href)) return '';
      return `${PATREON_ORIGIN}${location.pathname}${location.pathname === '/user' ? location.search : ''}`;
    }
    if (site === 'fanbox') {
      let match = location.hostname.match(/^([a-z0-9_-]+)\.fanbox\.cc$/i);
      if (match && !['www', 'api', 'downloads'].includes(match[1].toLowerCase())) {
        const creatorId = match[1];
        const post = location.pathname.match(/\/posts\/(\d+)/i);
        return post ? `https://${creatorId}.fanbox.cc/posts/${post[1]}` : `https://${creatorId}.fanbox.cc/`;
      }

      match = href.match(/(?:www\.)?fanbox\.cc\/@([a-z0-9_-]+)(?:\/(?:posts(?:\/(\d+))?|plans|shop|about)?)?/i)
        || location.pathname.match(/^\/@([a-z0-9_-]+)(?:\/(?:posts(?:\/(\d+))?|plans|shop|about)?)?/i);
      if (match) {
        return match[2]
          ? `${FANBOX_WWW}/@${match[1]}/posts/${match[2]}`
          : `${FANBOX_WWW}/@${match[1]}`;
      }

      match = location.pathname.match(/\/posts\/(\d+)/i) || href.match(/\/posts\/(\d+)/i);
      if (match) return `${FANBOX_WWW}/posts/${match[1]}`;

      const creatorId = extractFanboxCreatorFromDom();
      if (creatorId) return `${FANBOX_WWW}/@${creatorId}`;
      return '';
    }

    let match = location.pathname.match(/^\/fanclubs\/(\d+)/) || href.match(/fantia\.jp\/fanclubs\/(\d+)/i);
    if (match) return `${FANTIA_ORIGIN}/fanclubs/${match[1]}`;
    match = location.pathname.match(/^\/posts\/(\d+)/) || href.match(/fantia\.jp\/posts\/(\d+)/i);
    if (match) return `${FANTIA_ORIGIN}/posts/${match[1]}`;
    return '';
  }

  function getTargetForSite(site) {
    const map = settings.targetsBySite || {};
    return String(map[site] || '').trim();
  }

  function rememberTargetForSite(site, value) {
    const next = String(value || '').trim();
    settings.targetsBySite = {
      fantia: '',
      fanbox: '',
      patreon: '',
      pawchive: '',
      ...(settings.targetsBySite || {}),
      [site]: next,
    };
    if (site === PAGE_SITE) settings.target = next;
  }

  function activeTargetForCurrentPage(preferLocation = true) {
    const fromLocation = targetFromLocation();
    if (preferLocation && fromLocation) return fromLocation;

    // 只允许回填当前平台保存的目标，绝不串用另一平台链接。
    const saved = getTargetForSite(PAGE_SITE);
    const parsed = parseTarget(saved);
    if (parsed && targetSite(parsed) === PAGE_SITE) return saved;
    return fromLocation || '';
  }

  function resetOwnerStateIfNeeded(site) {
    if (state.fanclub && state.fanclub.site && state.fanclub.site !== site) {
      state.fanclub = null;
      state.plans = new Map();
      state.plansFor = '';
      state.collections = new Map();
      state.collectionsFor = '';
      state.collectionPostMap = new Map();
      state.unlockedPlanIds = null;
      state.planAutoKey = '';
      state.planAutoTried = '';
      state.planManual = false;
      state.collectionManual = false;
    }
  }

  function syncTargetWithCurrentPage(force = false) {
    if (state.crawling && !force) return settings.target;
    const fromLocation = targetFromLocation();
    const saved = getTargetForSite(PAGE_SITE);
    const savedParsed = parseTarget(saved);
    const savedOk = !!(savedParsed && targetSite(savedParsed) === PAGE_SITE);

    // 优先当前页；当前页识别失败时，回退到本平台已保存目标，绝不拿空值覆盖。
    let next = fromLocation || (savedOk ? saved : '');
    const parsedNext = parseTarget(next);
    const parsedCurrent = parseTarget(settings.target);
    const crossSite = !!(parsedCurrent && targetSite(parsedCurrent) !== PAGE_SITE);
    const shouldReplace = force || crossSite || settings.target !== next;

    if (shouldReplace) {
      if (next || crossSite) {
        settings.target = next;
        if (next) rememberTargetForSite(PAGE_SITE, next);
        else if (crossSite) rememberTargetForSite(PAGE_SITE, '');
        if (!(parsedNext && parsedNext.postId)) settings.scope = 'fanclub';
        resetOwnerStateIfNeeded(PAGE_SITE);
        saveSettings();
      }
    }
    if (ui) {
      fillForm();
      applyTheme(PAGE_SITE);
      if (ui.$('fdl-target')) ui.$('fdl-target').value = settings.target || '';
    }
    return settings.target || next;
  }

  function openPanel() {
    if (!ui) return;
    let fromLocation = syncTargetWithCurrentPage(true);
    applyTheme(PAGE_SITE);
    maybePreferSiteTemplate(PAGE_SITE);
    let target = parseTarget(settings.target || fromLocation);
    if (target && targetSite(target) === PAGE_SITE) maybePreferSiteTemplate(targetSite(target));
    ui.$('fdl').classList.add('open');
    scheduleLauncherAvoidance();
    renderHistory();
    if (ui.$('fdl-target')) ui.$('fdl-target').value = settings.target || '';
    refreshTarget();

    // 部分站点前端路由会晚一点写入地址栏 / DOM，短延迟后再同步一次。
    if ((PAGE_SITE === 'fanbox' || PAGE_SITE === 'patreon') && !parseTarget(settings.target)) {
      setTimeout(() => {
        if (!ui || !ui.$('fdl').classList.contains('open')) return;
        fromLocation = syncTargetWithCurrentPage(true);
        if (ui.$('fdl-target')) ui.$('fdl-target').value = settings.target || fromLocation || '';
        refreshTarget();
      }, 400);
      setTimeout(() => {
        if (!ui || !ui.$('fdl').classList.contains('open')) return;
        fromLocation = syncTargetWithCurrentPage(true);
        if (ui.$('fdl-target')) ui.$('fdl-target').value = settings.target || fromLocation || '';
        refreshTarget();
      }, 1200);
    }

    setTimeout(() => ui.$('fdl-target').focus({ preventScroll: true }), 80);
  }

  function closePanel() {
    if (ui) ui.$('fdl').classList.remove('open');
  }

  function switchTab(name) {
    ui.root.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    ui.root.querySelectorAll('[data-pane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.pane === name));
    if (name === 'download') schedulePreview();
    if (name === 'more') renderHistory();
  }

  function renderScope() {
    const target = parseTarget(settings.target);
    ui.$('fdl-scope').hidden = !(target && target.postId);
    renderDateControls();
  }

  function renderDateControls() {
    if (!ui) return;
    const singlePost = settings.scope === 'post' && !!(parseTarget(settings.target) || {}).postId;
    const from = ui.$('fdl-from');
    const to = ui.$('fdl-to');
    const hint = ui.$('fdl-date-hint');
    const controls = ui.$('fdl-date-controls');
    const row = controls && controls.closest('.row');
    if (from) from.disabled = singlePost;
    if (to) to.disabled = singlePost;
    if (hint) hint.hidden = !singlePost;
    if (row) row.classList.toggle('is-disabled', singlePost);
    ui.root.querySelectorAll('[data-quick]').forEach((button) => {
      button.disabled = singlePost;
    });
  }

  async function refreshTarget() {
    const target = parseTarget(settings.target);
    renderScope();
    if (!target) {
      renderCollections();
      renderTargetInfo('支持 Fantia / Fanbox / Patreon / Pawchive 作者主页、投稿链接，以及 Patreon 合集链接。');
      return;
    }
    const site = targetSite(target);
    maybePreferSiteTemplate(site);
    try {
      const ownerId = await resolveFanclubId(target);
      await ensurePlans(ownerId, undefined, site);
      if (site === 'patreon') {
        await ensurePatreonCollections(ownerId, undefined, target.collectionId || '');
      } else {
        state.collections = new Map();
        state.collectionsFor = '';
        state.collectionPostMap = new Map();
        renderCollections();
      }
      renderTargetInfo();
    } catch (error) {
      renderTargetInfo(`暂时无法识别目标：${error.message}`);
    }
  }

  function renderTargetInfo(message) {
    if (!ui) return;
    const fanclub = state.fanclub;
    const site = fanclub && fanclub.site ? fanclub.site : targetSite(parseTarget(settings.target));
    const text = message || (fanclub ? `已识别：${siteLabel(site)} · ${fanclub.user || fanclub.name}${fanclub.name && fanclub.user && fanclub.name !== fanclub.user ? ` · ${fanclub.name}` : ''}（${fanclub.id}）` : '正在识别目标…');
    ui.$('fdl-target-info').textContent = text;
    const collectionPart = site === 'patreon' && state.collections.size
      ? ` · ${state.collections.size} 个合集`
      : '';
    ui.$('fdl-sub').textContent = fanclub
      ? `${siteLabel(site)} · ${fanclub.user || fanclub.name} · ${state.plans.size} 个订阅方案${collectionPart}`
      : '打开 Fantia / Fanbox / Patreon / Pawchive 作者主页或投稿页即可开始';
  }

  function formatPlanPrice(plan, site) {
    if (plan == null || plan.price === '' || plan.price == null) return '';
    const value = Number(plan.price);
    if (!Number.isFinite(value)) return '';
    if (site === 'patreon') {
      const currency = (state.fanclub && state.fanclub.currency) || 'USD';
      try {
        return ` · ${new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)}`;
      } catch (_) {
        return ` · ${value}`;
      }
    }
    return ` · ${value.toLocaleString()}円`;
  }

  function renderPlans(message) {
    if (!ui) return;
    const excluded = new Set(settings.excludedPlans);
    const site = (state.fanclub && state.fanclub.site) || targetSite(parseTarget(settings.target)) || PAGE_SITE;
    const plans = Array.from(state.plans.values()).sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    const chips = [
      { id: FREE_PLAN_KEY, label: '公开内容（无方案限制）' },
      ...plans.map((plan) => ({ id: plan.id, label: `${plan.name}${formatPlanPrice(plan, site)}` })),
    ];
    ui.$('fdl-plans').innerHTML = chips.map((chip) => `
      <label class="chip"><input type="checkbox" data-plan="${escapeHtml(chip.id)}" ${excluded.has(chip.id) ? '' : 'checked'}><span>${escapeHtml(chip.label)}</span></label>
    `).join('') + (message ? `<span class="hint" style="margin:6px 0 0">${escapeHtml(message)}</span>` : '');
  }

  function renderCollections(message) {
    if (!ui) return;
    const row = ui.$('fdl-collections-row');
    const site = (state.fanclub && state.fanclub.site) || targetSite(parseTarget(settings.target)) || PAGE_SITE;
    const show = site === 'patreon';
    if (row) row.hidden = !show;
    if (!show) {
      if (ui.$('fdl-collections')) ui.$('fdl-collections').innerHTML = '';
      return;
    }
    const excluded = new Set((settings.excludedCollections || []).map(String));
    const collections = Array.from(state.collections.values()).sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
    const chips = [
      { id: COLLECTION_NONE_KEY, label: '未合集' },
      ...collections.map((item) => ({
        id: item.id,
        label: `${item.title}${item.numPosts ? ` · ${item.numPosts}` : ''}`,
      })),
    ];
    ui.$('fdl-collections').innerHTML = chips.map((chip) => `
      <label class="chip"><input type="checkbox" data-collection="${escapeHtml(chip.id)}" ${excluded.has(chip.id) ? '' : 'checked'}><span>${escapeHtml(chip.label)}</span></label>
    `).join('') + (message ? `<span class="hint" style="margin:6px 0 0">${escapeHtml(message)}</span>` : '');
  }

  function renderSummary() {
    if (!ui) return;
    const result = state.filtered;
    if (!state.order.length) {
      ui.$('fdl-summary').innerHTML = `<div class="empty">${state.crawling ? '正在抓取…' : '设置筛选条件后点击“开始抓取”。'}</div>`;
      return;
    }
    const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    let knownSize = 0;
    for (const item of result.items) {
      counts[item.kind] += 1;
      knownSize += item.size || 0;
    }
    const cells = [
      [result.posts, `投稿 / 已读取 ${state.order.length}`],
      [result.items.length, '待下载文件'],
      ...TYPE_ORDER.filter((type) => counts[type] || settings.types[type]).map((type) => [counts[type], TYPE_LABELS[type]]),
    ];
    if (knownSize) cells.push([formatBytes(knownSize), '已知大小']);
    ui.$('fdl-summary').innerHTML = `
      <div class="stats">${cells.map(([value, label]) => `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('')}</div>
      ${result.locked ? `<div class="notice">有 ${result.locked} 个所选方案的内容区块尚未解锁，已跳过。</div>` : ''}
      ${result.streamOnly ? `<div class="notice">有 ${result.streamOnly} 个内容只有在线播放，没有下载地址。</div>` : ''}
      ${settings.types.link && result.linkCount ? `<div class="notice">已提取 ${result.linkCount} 条网盘链接，将汇总到一个文本文件。</div>` : ''}
    `;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function sampleItem() {
    return {
      kind: 'image',
      post: {
        id: '10001',
        title: 'Sample Post',
        postedMs: Date.UTC(2026, 0, 1, 12, 0),
        user: 'ExampleCreator',
        fanclub: 'Example Fanclub',
        fanclubId: '12345',
        tags: '',
      },
      plan: { id: '100', name: 'Sample Plan', price: 500 },
      contentId: '200',
      contentTitle: '',
      index: 1,
      page: 1,
      name: 'sample-image',
      ext: 'png',
    };
  }

  function renderPreview() {
    if (!ui) return;
    const items = state.filtered.items.length ? state.filtered.items.slice(0, 80) : [sampleItem()];
    const rows = items.map((item) => `<div><i>${escapeHtml(TYPE_LABELS[item.kind])}</i>${escapeHtml(buildPath(item, settings))}</div>`);
    if (!state.filtered.items.length) rows.unshift('<div><i>示例</i>抓取后将显示真实文件名</div>');
    if (state.filtered.items.length > 80) rows.push(`<div><i>…</i>另有 ${state.filtered.items.length - 80} 个文件</div>`);
    ui.$('fdl-preview').innerHTML = rows.join('');
  }

  function renderButtons() {
    if (!ui) return;
    const dl = state.dl;
    const downloading = !!(dl && dl.running);
    const hasCrawlResult = state.order.length > 0;
    ui.$('fdl-crawl').disabled = state.crawling || downloading;
    ui.$('fdl-crawl-stop').disabled = !state.crawling;
    ui.$('fdl-go-download').disabled = state.crawling || downloading || !hasCrawlResult;
    ui.$('fdl-download').disabled = state.crawling || downloading || !state.filtered.items.length;
    ui.$('fdl-pause').disabled = !downloading;
    ui.$('fdl-pause').textContent = dl && dl.paused ? '继续' : '暂停';
    ui.$('fdl-stop').disabled = !downloading;
    ui.$('fdl-retry').disabled = downloading || !(dl && dl.failed.length);
    ui.$('fdl-foot').classList.toggle('busy', state.crawling || downloading);
    renderBadge();
  }

  function renderBadge() {
    if (!ui) return;
    const dl = state.dl;
    const badge = ui.$('fdl-badge');
    let text = '';
    if (dl && dl.running) {
      const completed = dl.done + dl.failed.length + dl.skipped;
      text = `${Math.floor((completed / Math.max(dl.total, 1)) * 100)}%`;
    } else if (state.filtered.items.length) {
      text = state.filtered.items.length > 999 ? '999+' : String(state.filtered.items.length);
    }
    badge.hidden = !text;
    badge.textContent = text;
  }

  function scheduleProgress() {
    if (progressFrame) return;
    progressFrame = requestAnimationFrame(() => {
      progressFrame = 0;
      renderProgress();
    });
  }

  function renderProgress() {
    if (!ui) return;
    const dl = state.dl;
    if (!dl) {
      ui.$('fdl-bar').style.width = '0%';
      return;
    }
    const completed = dl.done + dl.failed.length + dl.skipped;
    const percent = Math.round((completed / Math.max(dl.total, 1)) * 100);
    ui.$('fdl-bar').style.width = `${percent}%`;
    ui.$('fdl-dl-meta').innerHTML = `
      <span>完成 ${dl.done} · 失败 ${dl.failed.length} · 跳过 ${dl.skipped} · 等待 ${dl.queue.length}</span>
      <span>${completed}/${dl.total}（${percent}%）${dl.paused ? ' · 已暂停' : ''}</span>
    `;
    ui.$('fdl-active').innerHTML = Array.from(dl.active.values()).map((active) => {
      const ratio = active.total ? Math.min(active.loaded / active.total, 1) : 0;
      const size = active.total ? `${formatBytes(active.loaded)} / ${formatBytes(active.total)}` : (active.loaded ? formatBytes(active.loaded) : '等待响应');
      return `<div class="job"><div class="job-name" title="${escapeHtml(active.name)}">${escapeHtml(active.name)}</div><div class="hint" style="margin:2px 0 0">${size}</div><div class="job-bar"><div style="width:${Math.round(ratio * 100)}%"></div></div></div>`;
    }).join('');
    ui.$('fdl-failed').innerHTML = dl.failed.map((failure) => `<div>✕ ${escapeHtml(failure.name)}<br>&nbsp;&nbsp;${escapeHtml(failure.reason)}</div>`).join('');
    if (dl.running) setStatus(`${dl.paused ? '已暂停' : '下载中'}：${completed}/${dl.total}`);
    renderBadge();
    renderHistory();
  }

  function renderHistory() {
    if (ui) ui.$('fdl-history-count').textContent = `已记录 ${state.history.size} 个文件`;
  }

  function setStatus(text) {
    if (ui) ui.$('fdl-status').textContent = text;
  }

  function clearLog() {
    if (ui) ui.$('fdl-log').innerHTML = '';
  }

  function log(message, level = '') {
    console.log(`[FanLoot] ${message}`);
    if (!ui) return;
    const box = ui.$('fdl-log');
    const line = document.createElement('div');
    line.className = level;
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    box.appendChild(line);
    while (box.children.length > 300) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  async function copyLinks() {
    const lines = state.filtered.items
      .filter((item) => item.url)
      .map((item) => `${item.url}\t${buildPath(item, settings)}`);
    if (!lines.length) {
      log('没有可复制的链接。', 'warn');
      return;
    }
    const text = lines.join('\n');
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else await navigator.clipboard.writeText(text);
      log(`已复制 ${lines.length} 条链接。`, 'ok');
      setStatus(`已复制 ${lines.length} 条链接`);
    } catch (error) {
      log(`复制失败：${error.message}`, 'bad');
    }
  }

  function init() {
    if (window.top !== window.self || document.getElementById('fanloot-downloader') || document.getElementById('fantia-fanbox-batch-downloader') || document.getElementById('fantia-batch-downloader')) return;
    mountUI();
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开 FanLoot', openPanel);
  }

  init();
})();
