// ==UserScript==
// @name         Fantia 批量下载器
// @namespace    https://fantia.jp/
// @version      1.0.0
// @description  批量下载 Fantia 作者投稿中的图片、视频、音频和附件；支持日期范围、订阅方案、文件类型筛选与自定义文件名规则。
// @author       fantia-downloader
// @match        https://fantia.jp/*
// @icon         https://fantia.jp/favicon.ico
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      fantia.jp
// @connect      c.fantia.jp
// @connect      cc.fantia.jp
// @connect      *
// @run-at       document-idle
// @noframes
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/601424/Fantia%20%E6%89%B9%E9%87%8F%E4%B8%8B%E8%BD%BD%E5%99%A8.user.js
// @updateURL https://update.greasyfork.org/scripts/601424/Fantia%20%E6%89%B9%E9%87%8F%E4%B8%8B%E8%BD%BD%E5%99%A8.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const TEST_HOOK = typeof globalThis !== 'undefined' ? globalThis.__FANTIA_DL_TEST__ : undefined;
  const ORIGIN = 'https://fantia.jp';
  const SETTINGS_KEY = 'fantiaDL.settings.v1';
  const HISTORY_KEY = 'fantiaDL.history.v1';
  const FREE_PLAN_KEY = 'free';
  const JST_OFFSET = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const CACHE_TTL = 20 * 60 * 1000;

  const TYPE_LABELS = {
    image: '图片',
    video: '视频',
    audio: '音频',
    file: '附件',
    cover: '封面',
    text: '正文',
  };
  const TYPE_ORDER = ['image', 'video', 'audio', 'file', 'cover', 'text'];
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
    scope: 'fanclub',
    dateFrom: '',
    dateTo: '',
    keyword: '',
    excludeKeyword: '',
    types: { image: true, video: true, audio: true, file: true, cover: false, text: false },
    excludedPlans: [],
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
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      types: { ...DEFAULT_SETTINGS.types, ...(saved.types || {}) },
      excludedPlans: Array.isArray(saved.excludedPlans) ? saved.excludedPlans.map(String) : [],
    };
  }

  function absUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, ORIGIN).href;
    } catch (_) {
      return '';
    }
  }

  function fileNameFromUrl(url) {
    if (!url) return '';
    try {
      const path = new URL(url, ORIGIN).pathname;
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
    const postLevel = item.kind === 'cover' || item.kind === 'text';
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
      plan: item.plan ? item.plan.name : (postLevel ? '' : '公开'),
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

  // ---------- Fantia data parsing ----------

  function normalizePlan(plan) {
    if (!plan || plan.id == null) return null;
    return {
      id: String(plan.id),
      name: plan.name || `方案 ${plan.id}`,
      price: plan.price ?? '',
    };
  }

  function parseTarget(input) {
    const value = String(input || '').trim();
    let match = value.match(/fanclubs\/(\d+)/i);
    if (match) return { fanclubId: match[1] };
    match = value.match(/posts\/(\d+)/i);
    if (match) return { postId: match[1] };
    if (/^\d+$/.test(value)) return { fanclubId: value };
    return null;
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

  function extractPost(post) {
    const fanclub = post.fanclub || {};
    const meta = {
      id: String(post.id),
      title: post.title || '',
      postedMs: parseDate(post.posted_at) ?? parseDate(post.converted_at),
      user: fanclub.creator_name || (fanclub.user && fanclub.user.name) || fanclub.name || '',
      fanclub: fanclub.name || fanclub.fanclub_name || '',
      fanclubId: fanclub.id == null ? '' : String(fanclub.id),
      tags: (post.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean).join(' '),
      url: `${ORIGIN}/posts/${post.id}`,
    };
    const entry = {
      meta,
      items: [],
      locked: [],
      streamOnly: [],
      plans: [],
      fetchedAt: Date.now(),
    };
    const textParts = [];
    let index = 0;

    const push = (item) => {
      if (!item.url && item.kind !== 'text') return;
      const postLevel = item.kind === 'cover' || item.kind === 'text';
      entry.items.push({
        ...item,
        post: meta,
        index: postLevel ? 0 : ++index,
        key: `${meta.id}:${item.uid}`,
      });
    };

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
            url: absUrl(url),
            ext: extFromUrl(url) || 'jpg',
            name: cleanCdnName(fileNameFromUrl(url)) || `${content.id}_${i + 1}`,
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
        const ext = extFromName(content.filename) || extFromUrl(content.download_uri) || 'bin';
        push({
          ...base,
          uid: `file-${content.id}`,
          kind: classifyExt(ext),
          url: absUrl(content.download_uri),
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
            url: absUrl(url),
            ext: extFromUrl(extSource) || 'jpg',
            name: cleanCdnName(fileNameFromUrl(image.url)) || `blog_${image.id || page}`,
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
        url: absUrl(thumb),
        ext: extFromUrl(thumb) || 'jpg',
        name: 'cover',
        plan: null,
        page: 1,
        size: 0,
      });
    }

    if (textParts.length) {
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

    return entry;
  }

  function filterEntries(entries, settings) {
    const from = settings.dateFrom ? dateInputToMs(settings.dateFrom, false) : null;
    const to = settings.dateTo ? dateInputToMs(settings.dateTo, true) : null;
    const include = splitWords(settings.keyword);
    const exclude = splitWords(settings.excludeKeyword);
    const excludedPlans = new Set((settings.excludedPlans || []).map(String));
    const allowPlan = (plan) => !excludedPlans.has(plan ? plan.id : FREE_PLAN_KEY);
    const result = { items: [], posts: 0, matchedPosts: 0, locked: 0, streamOnly: 0 };

    for (const entry of entries) {
      const meta = entry.meta;
      if (from != null && (meta.postedMs == null || meta.postedMs < from)) continue;
      if (to != null && (meta.postedMs == null || meta.postedMs > to)) continue;
      const haystack = `${meta.title} ${meta.tags}`.toLowerCase();
      if (include.length && !include.some((word) => haystack.includes(word))) continue;
      if (exclude.some((word) => haystack.includes(word))) continue;
      if (entry.plans.length && !entry.plans.some(allowPlan)) continue;

      result.matchedPosts += 1;
      let count = 0;
      for (const item of entry.items) {
        if (!settings.types[item.kind]) continue;
        if (item.kind !== 'cover' && item.kind !== 'text' && !allowPlan(item.plan)) continue;
        result.items.push(item);
        count += 1;
      }
      result.locked += entry.locked.filter((content) => allowPlan(content.plan)).length;
      result.streamOnly += entry.streamOnly.filter((content) => allowPlan(content.plan)).length;
      if (count) result.posts += 1;
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
      filterEntries,
      formatDate,
      listDateToMs,
      parseTarget,
      sanitizeSegment,
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
    fanclub: null,
    filtered: { items: [], posts: 0, matchedPosts: 0, locked: 0, streamOnly: 0 },
    crawling: false,
    crawlAbort: null,
    csrfToken: '',
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

  // ---------- Fantia requests ----------

  async function getCsrfToken() {
    if (state.csrfToken) return state.csrfToken;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) {
      state.csrfToken = meta.content;
      return state.csrfToken;
    }
    const response = await fetch(`${ORIGIN}/`, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    state.csrfToken = (doc.querySelector('meta[name="csrf-token"]') || {}).content || '';
    return state.csrfToken;
  }

  async function request(url, options = {}, attempt = 1) {
    const json = options.json !== false;
    const headers = {};
    if (json) {
      headers.Accept = 'application/json, text/plain, */*';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['X-CSRF-Token'] = await getCsrfToken();
    }
    let response;
    try {
      response = await fetch(absUrl(url), { credentials: 'include', headers, signal: options.signal });
    } catch (error) {
      if (options.signal && options.signal.aborted) throw error;
      if (attempt < 4) {
        await sleepAbortable(1500 * attempt, options.signal);
        return request(url, options, attempt + 1);
      }
      throw error;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      log(`请求过快或服务器繁忙（HTTP ${response.status}），${4 * attempt} 秒后重试…`, 'warn');
      await sleepAbortable(4000 * attempt, options.signal);
      return request(url, options, attempt + 1);
    }
    if (json && [401, 403, 422].includes(response.status) && attempt === 1) {
      state.csrfToken = '';
      return request(url, options, attempt + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return json ? response.json() : response.text();
  }

  async function fetchPost(postId, signal) {
    const data = await request(`/api/v1/posts/${postId}`, { signal });
    if (!data || !data.post) throw new Error('接口没有返回投稿数据');
    return data.post;
  }

  async function getPostEntry(postId, signal) {
    const cached = state.posts.get(String(postId));
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return { entry: cached, fresh: false };
    const post = await fetchPost(postId, signal);
    const entry = extractPost(post);
    state.posts.set(entry.meta.id, entry);
    registerPlans(entry);
    if (!state.fanclub && post.fanclub) {
      state.fanclub = {
        id: String(post.fanclub.id),
        name: post.fanclub.name || '',
        user: post.fanclub.creator_name || '',
      };
    }
    return { entry, fresh: true };
  }

  async function resolveFanclubId(target, signal) {
    if (target.fanclubId) return target.fanclubId;
    const { entry } = await getPostEntry(target.postId, signal);
    if (!entry.meta.fanclubId) throw new Error('无法从投稿中识别作者');
    return entry.meta.fanclubId;
  }

  async function listPosts(fanclubId, signal, onPage) {
    const seen = new Set();
    const cards = [];
    for (let page = 1; page <= 1000; page += 1) {
      const html = await request(`/fanclubs/${fanclubId}/posts?page=${page}`, { json: false, signal });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let fresh = 0;
      for (const card of parsePostCards(doc)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        cards.push(card);
        fresh += 1;
      }
      onPage(page, cards.length);
      if (!fresh || !doc.querySelector('.pagination a[rel="next"], a[rel="next"]')) break;
      await sleepAbortable(Math.max(200, settings.requestDelay), signal);
    }
    return cards;
  }

  async function ensurePlans(fanclubId, signal) {
    if (!fanclubId || state.plansFor === String(fanclubId)) return;
    state.plansFor = String(fanclubId);
    state.plans = new Map();
    state.fanclub = null;
    renderPlans('正在读取订阅方案…');
    try {
      const data = await request(`/api/v1/fanclubs/${fanclubId}`, { signal });
      const fanclub = data.fanclub || data;
      state.fanclub = {
        id: String(fanclub.id || fanclubId),
        name: fanclub.name || fanclub.fanclub_name || '',
        user: fanclub.creator_name || (fanclub.user && fanclub.user.name) || '',
      };
      for (const plan of fanclub.plans || []) {
        const normalized = normalizePlan(plan);
        if (normalized) state.plans.set(normalized.id, normalized);
      }
    } catch (error) {
      log(`方案接口读取失败，尝试解析方案页面：${error.message}`, 'warn');
      try {
        const html = await request(`/fanclubs/${fanclubId}/plans`, { json: false, signal });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const node of doc.querySelectorAll('[id^="plan-id-"]')) {
          const id = node.id.replace('plan-id-', '');
          const title = node.querySelector('.plan-title');
          const price = node.querySelector('.plan-price');
          const priceMatch = price && price.textContent.match(/\(([\d,]+)\s*JPY\)/);
          state.plans.set(id, {
            id,
            name: (title && title.textContent.trim()) || `方案 ${id}`,
            price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : '',
          });
        }
      } catch (fallbackError) {
        log(`方案页面读取失败：${fallbackError.message}`, 'warn');
      }
      const cachedEntry = Array.from(state.posts.values()).find((entry) => entry.meta.fanclubId === String(fanclubId));
      if (cachedEntry) {
        state.fanclub = { id: String(fanclubId), name: cachedEntry.meta.fanclub, user: cachedEntry.meta.user };
      }
    }
    for (const entry of state.posts.values()) {
      if (entry.meta.fanclubId === String(fanclubId)) {
        for (const plan of entry.plans) if (plan && !state.plans.has(plan.id)) state.plans.set(plan.id, plan);
      }
    }
    renderTargetInfo();
    renderPlans();
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
    const target = parseTarget(settings.target);
    if (!target) {
      log('请输入作者主页链接、投稿链接或粉丝团 ID。', 'bad');
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
        log(`抓取单个投稿 #${target.postId}`);
      } else {
        const fanclubId = await resolveFanclubId(target, controller.signal);
        await ensurePlans(fanclubId, controller.signal);
        log(`开始读取作者 ${state.fanclub && state.fanclub.user ? state.fanclub.user : `#${fanclubId}`} 的投稿列表`);
        const allCards = await listPosts(fanclubId, controller.signal, (page, total) => {
          setStatus(`投稿列表第 ${page} 页，已发现 ${total} 个投稿`);
        });
        // Updated time is never earlier than posted time, so this safely avoids extra API calls.
        const fromMs = settings.dateFrom ? dateInputToMs(settings.dateFrom, false) - DAY : null;
        cards = allCards.filter((card) => !(fromMs != null && card.updatedMs != null && card.updatedMs < fromMs));
        log(`发现 ${allCards.length} 个投稿${allCards.length !== cards.length ? `，按起始日期预先跳过 ${allCards.length - cards.length} 个` : ''}`);
      }

      for (let i = 0; i < cards.length; i += 1) {
        if (controller.signal.aborted) break;
        const id = cards[i].id;
        setStatus(`正在读取投稿 ${i + 1}/${cards.length}（#${id}）`);
        try {
          const { entry, fresh } = await getPostEntry(id, controller.signal);
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
        url: item.kind === 'text' ? textDataUrl(item.text) : item.url,
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
      --accent: #df2f59;
      --accent-deep: #a91d43;
      --accent-soft: #ffe3e9;
      --apricot: #ff9b63;
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
      position: fixed; right: 18px; bottom: 92px; z-index: 2147483645;
      width: 58px; height: 58px; border: 0; border-radius: 19px;
      display: grid; place-items: center; color: #fff;
      background: linear-gradient(145deg, var(--accent), var(--apricot));
      box-shadow: 0 12px 28px rgba(223, 47, 89, .36), inset 0 1px rgba(255,255,255,.35);
      transition: transform .22s ease, box-shadow .22s ease;
      animation: launcherIn .55s cubic-bezier(.2,.9,.25,1.25) both;
    }
    .launcher:hover { transform: translateY(-3px) rotate(-5deg); box-shadow: 0 16px 32px rgba(223, 47, 89, .42); }
    .launcher svg { width: 27px; height: 27px; }
    .badge {
      position: absolute; top: -7px; right: -7px; min-width: 24px; height: 24px; padding: 0 6px;
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
      background:
        radial-gradient(circle at 95% -25%, rgba(255,155,99,.5), transparent 38%),
        radial-gradient(circle at 70% 120%, rgba(223,47,89,.13), transparent 34%),
        repeating-linear-gradient(135deg, rgba(223,47,89,.045) 0 7px, transparent 7px 15px),
        #fff;
    }
    .head-top { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark {
      flex: 0 0 auto; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center;
      color: #fff; background: var(--ink); font: 900 22px/1 Georgia, "Times New Roman", serif;
      box-shadow: 5px 5px 0 var(--accent);
    }
    .title { font-size: 20px; font-weight: 900; letter-spacing: .02em; }
    .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .icon-btn { width: 36px; height: 36px; border: 0; border-radius: 12px; background: rgba(42,28,33,.06); font-size: 24px; line-height: 1; }
    .icon-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tabs { display: flex; gap: 6px; margin-top: 14px; overflow-x: auto; }
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
    .input:focus, .date:focus, .number:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(223,47,89,.13); }
    .date { width: auto; min-width: 150px; }
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
    .chip input:checked + span { border-color: rgba(223,47,89,.36); background: var(--accent-soft); color: var(--accent-deep); font-weight: 800; }
    .chip input:checked + span::before { background: var(--accent); box-shadow: 0 0 0 3px rgba(223,47,89,.14); }
    .chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chip:hover span, .mini:hover, .var:hover { transform: translateY(-1px); border-color: rgba(223,47,89,.38); }
    .mini { border-radius: 9px; font-size: 12px; }
    .var { border-radius: 8px; border-style: dashed; font-size: 12px; }
    .var code { color: var(--accent-deep); font: 700 12px "Cascadia Code", Consolas, monospace; }
    .seg { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding: 4px; border-radius: 12px; background: #f6e9eb; }
    .seg label { display: inline-flex; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg span { padding: 5px 10px; border-radius: 9px; color: var(--muted); }
    .seg input:checked + span { background: #fff; color: var(--accent-deep); font-weight: 800; box-shadow: 0 2px 7px rgba(42,28,33,.08); }
    .check { display: inline-flex; align-items: center; gap: 8px; margin-left: 18px; }
    .check input { accent-color: var(--accent); width: 16px; height: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; padding: 16px 0 12px; animation: rise .38s ease both; animation-delay: 260ms; }
    .btn { min-height: 39px; padding: 8px 17px; border: 1px solid transparent; border-radius: 12px; font-weight: 900; transition: transform .15s, box-shadow .15s, background .15s; }
    .btn:not(:disabled):hover { transform: translateY(-1px); }
    .primary { color: #fff; background: linear-gradient(135deg, var(--accent), #f0605b); box-shadow: 0 9px 18px rgba(223,47,89,.24); }
    .dark { color: #fff; background: var(--ink); box-shadow: 4px 4px 0 var(--accent); }
    .ghost { border-color: var(--line); background: #fff; }
    .danger { color: var(--bad); border-color: #f0c8c8; background: #fff; }
    .summary {
      margin-top: 2px; padding: 14px; border: 1px solid var(--line); border-radius: 16px;
      background: linear-gradient(135deg, #fff, #fff6f2);
    }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
    .stat { padding: 10px; border-radius: 12px; background: #fff; border: 1px solid #f4e6e8; }
    .stat b { display: block; font: 900 21px/1.1 Georgia, "Times New Roman", serif; }
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
    .bar { width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--apricot)); transition: width .25s ease; }
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
      .launcher { right: 12px; bottom: 74px; width: 50px; height: 50px; border-radius: 16px; }
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
      <button class="launcher" id="fdl-launch" type="button" title="Fantia 批量下载" aria-label="打开 Fantia 批量下载器">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M5 17.5V20h14v-2.5" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="badge" id="fdl-badge" hidden></span>
      </button>
      <div class="overlay" id="fdl-overlay"></div>
      <section class="panel" role="dialog" aria-modal="true" aria-label="Fantia 批量下载器">
        <header class="head">
          <div class="head-top">
            <div class="brand">
              <div class="mark">F</div>
              <div style="min-width:0">
                <div class="title">Fantia 批量下载器</div>
                <div class="sub" id="fdl-sub">打开作者主页或投稿页即可开始</div>
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
                <input class="input" id="fdl-target" placeholder="https://fantia.jp/fanclubs/123456 或投稿链接">
                <div class="hint" id="fdl-target-info">支持作者主页、作者投稿列表、投稿详情链接或粉丝团 ID。</div>
                <div class="seg" id="fdl-scope" hidden>
                  <label><input type="radio" name="fdl-scope" value="fanclub"><span>该作者全部投稿</span></label>
                  <label><input type="radio" name="fdl-scope" value="post"><span>仅当前投稿</span></label>
                </div>
              </div>
            </div>
            <div class="row">
              <div class="label">投稿日期<small>JST，含起止日</small></div>
              <div>
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
              <button class="btn dark" id="fdl-go-download" type="button">下一步：下载 →</button>
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
                <div class="hint">每行格式：URL + Tab + 预计保存路径。Fantia 链接可能有时效或需要登录 Cookie。</div>
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
                <li>下载链接有时效；抓取后很久才下载出现大量失败时，请重新抓取。</li>
              </ul>
            </div>
          </div>
        </div>
        <footer class="foot" id="fdl-foot"><span class="pulse"></span><span id="fdl-status">准备就绪</span></footer>
      </section>
    </div>
  `;

  function mountUI() {
    const host = document.createElement('div');
    host.id = 'fantia-batch-downloader';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    document.documentElement.appendChild(host);
    const $ = (id) => root.querySelector(`#${id}`);
    ui = { root, $ };

    root.querySelectorAll('.pane').forEach((pane) => {
      pane.querySelectorAll('.row').forEach((row, i) => row.style.setProperty('--i', String(i)));
    });

    $('fdl-types').innerHTML = TYPE_ORDER.map((type) => `
      <label class="chip"><input type="checkbox" data-type="${type}"><span>${TYPE_LABELS[type]}</span></label>
    `).join('');
    $('fdl-vars').innerHTML = VARIABLES.map(([token, label]) => `
      <button class="var" type="button" data-var="${token}" title="${escapeHtml(label)}"><code>${token}</code>${escapeHtml(label)}</button>
    `).join('');

    fillForm();
    bindEvents();
    renderPlans();
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
      saveSettings();
      renderScope();
      clearTimeout(targetTimer);
      targetTimer = setTimeout(refreshTarget, 650);
    });
    root.querySelectorAll('input[name="fdl-scope"]').forEach((input) => input.addEventListener('change', () => {
      settings.scope = input.value;
      saveSettings();
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
      saveSettings();
      applyFilters();
    });
    root.querySelectorAll('[data-plans]').forEach((button) => button.addEventListener('click', () => {
      settings.excludedPlans = button.dataset.plans === 'all'
        ? []
        : [FREE_PLAN_KEY, ...Array.from(state.plans.keys())];
      saveSettings();
      renderPlans();
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
    $('fdl-clear-history').addEventListener('click', () => {
      if (!state.history.size || !confirm(`确定清除 ${state.history.size} 条下载记录吗？`)) return;
      state.history.clear();
      gmSet(HISTORY_KEY, []);
      renderHistory();
      log('下载记录已清除。', 'ok');
    });
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

  function targetFromLocation() {
    let match = location.pathname.match(/^\/fanclubs\/(\d+)/);
    if (match) return `${ORIGIN}/fanclubs/${match[1]}`;
    match = location.pathname.match(/^\/posts\/(\d+)/);
    if (match) return `${ORIGIN}/posts/${match[1]}`;
    return '';
  }

  function openPanel() {
    if (!ui) return;
    const fromLocation = targetFromLocation();
    if (fromLocation && !state.crawling && fromLocation !== settings.target) {
      settings.target = fromLocation;
      settings.scope = 'fanclub';
      saveSettings();
      fillForm();
    }
    ui.$('fdl').classList.add('open');
    renderHistory();
    refreshTarget();
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
  }

  async function refreshTarget() {
    const target = parseTarget(settings.target);
    renderScope();
    if (!target) {
      renderTargetInfo('支持作者主页、作者投稿列表、投稿详情链接或粉丝团 ID。');
      return;
    }
    try {
      const fanclubId = await resolveFanclubId(target);
      await ensurePlans(fanclubId);
      renderTargetInfo();
    } catch (error) {
      renderTargetInfo(`暂时无法识别目标：${error.message}`);
    }
  }

  function renderTargetInfo(message) {
    if (!ui) return;
    const fanclub = state.fanclub;
    const text = message || (fanclub ? `已识别：${fanclub.user || fanclub.name}${fanclub.name && fanclub.user ? ` · ${fanclub.name}` : ''}（#${fanclub.id}）` : '正在识别目标…');
    ui.$('fdl-target-info').textContent = text;
    ui.$('fdl-sub').textContent = fanclub ? `${fanclub.user || fanclub.name} · ${state.plans.size} 个订阅方案` : '打开作者主页或投稿页即可开始';
  }

  function renderPlans(message) {
    if (!ui) return;
    const excluded = new Set(settings.excludedPlans);
    const plans = Array.from(state.plans.values()).sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    const chips = [
      { id: FREE_PLAN_KEY, label: '公开内容（无方案限制）' },
      ...plans.map((plan) => ({ id: plan.id, label: `${plan.name}${plan.price !== '' ? ` · ${Number(plan.price).toLocaleString()}円` : ''}` })),
    ];
    ui.$('fdl-plans').innerHTML = chips.map((chip) => `
      <label class="chip"><input type="checkbox" data-plan="${escapeHtml(chip.id)}" ${excluded.has(chip.id) ? '' : 'checked'}><span>${escapeHtml(chip.label)}</span></label>
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
        id: '4291239',
        title: 'Essie',
        postedMs: Date.UTC(2026, 9, 20, 9, 35),
        user: 'タンスの奥',
        fanclub: 'タンスの奥 (mob)',
        fanclubId: '178410',
        tags: '',
      },
      plan: { id: '625854', name: '投げ銭300', price: 300 },
      contentId: '7862661',
      contentTitle: '',
      index: 1,
      page: 1,
      name: '13c88b3d-28b6-41c1-8622-f0a2886d926f',
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
    ui.$('fdl-crawl').disabled = state.crawling || downloading;
    ui.$('fdl-crawl-stop').disabled = !state.crawling;
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
    console.log(`[Fantia Downloader] ${message}`);
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
    if (window.top !== window.self || document.getElementById('fantia-batch-downloader')) return;
    mountUI();
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开 Fantia 批量下载器', openPanel);
  }

  init();
})();
