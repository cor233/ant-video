(function () {
  'use strict';

  var APP_ID = 'com.leospring.source_t4_bridge';
  var DEFAULT_KEY = 'source-t4-default';
  var LAN_KEY = 'source-t4-lan';
  var INTERNAL_BASE = 'miniapp://' + APP_ID;

  // 宿主采集源的并发上限是 3（超了直接 TOO_MANY_REQUESTS），
  // 这里统一排队、最多 2 个在飞，留 1 个余量给宿主自己或其它小程序。
  var MAX_INFLIGHT = 2;
  // 站点列表短缓存：config 被轮询时别每次都打宿主。
  var SITES_TTL = 30000;

  var siteListEl = document.getElementById('site-list');
  var statusEl = document.getElementById('status');
  var output = document.getElementById('config-output');
  var configUrl = document.getElementById('config-url');
  var linkList = document.getElementById('link-list');
  var lanForm = document.getElementById('lan-form');
  var lanInput = document.getElementById('lan-base');
  var scopeHint = document.getElementById('scope-hint');
  var exportStatus = document.getElementById('export-status');
  var prefixSample = document.getElementById('prefix-sample');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

  var sites = [];            // 宿主采集源 [{key,name,type,searchable}]
  var sitesCacheAt = 0;
  var defaultKey = '';       // 默认站点 key
  var lan = { base: '', detected: '', detectedAt: 0 };
  var scope = 'internal';
  var activeConfigUrl = '';

  /* ---------------- 基础工具 ---------------- */

  function jsonResponse(value, statusCode) {
    return {
      status: statusCode || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(value)
    };
  }

  function errorResponse(code, message, statusCode) {
    return jsonResponse({ code: code, msg: message, data: null }, statusCode || 400);
  }

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setExportStatus(message, kind) {
    exportStatus.textContent = message || '';
    exportStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  function copyText(text, label) {
    if (!text) { setExportStatus('没有可复制的内容。', 'error'); return; }
    ant.clipboard.set(text).then(function () {
      setExportStatus(label + '已复制。', 'ok');
    }).catch(function (e) {
      setExportStatus('复制失败：' + ((e && e.message) || e), 'error');
    });
  }

  function asList(value) { return Array.isArray(value) ? value : []; }

  function sourceError(error, fallbackCode) {
    var e = error instanceof Error ? error : new Error(String(error));
    if (!e.code) e.code = fallbackCode || 'SOURCE_FAILED';
    return e;
  }

  /* ---------------- 采集源调用（排队 + 缓存） ---------------- */

  var inflight = 0;
  var waiting = [];

  function pump() {
    while (inflight < MAX_INFLIGHT && waiting.length) {
      var job = waiting.shift();
      inflight++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).then(function () {
        inflight--;
        pump();
      });
    }
  }

  function enqueue(task) {
    return new Promise(function (resolve, reject) {
      waiting.push({ task: task, resolve: resolve, reject: reject });
      pump();
    });
  }

  function listSites(force) {
    if (!force && sites.length && Date.now() - sitesCacheAt < SITES_TTL) {
      return Promise.resolve(sites);
    }
    return enqueue(function () { return ant.source.list(); }).then(function (list) {
      sites = asList(list).filter(function (site) { return site && site.key; });
      sitesCacheAt = Date.now();
      return sites;
    });
  }

  function readDefaultKey() {
    return ant.storage.get(DEFAULT_KEY).then(function (saved) {
      defaultKey = String(saved || '').trim();
      return defaultKey;
    });
  }

  function writeDefaultKey(key) {
    defaultKey = key;
    return ant.storage.set(DEFAULT_KEY, key);
  }

  function selectSite(list, requested) {
    if (requested) return list.find(function (site) { return site.key === requested; });
    return list.find(function (site) { return site.key === defaultKey; }) || list[0];
  }

  /* ---------------- 数据形状适配（宿主 → T4） ---------------- */

  /**
   * 宿主把 vod_play_from / vod_play_url 按 $$$ 切成了数组（vod_play_url 每条线
   * 还是 `名称$id#名称$id` 的字符串）；T4 调用方（TVBox 系）要的是 CMS 原始
   * 字符串格式，这里拼回去。
   */
  function serializeVod(vod) {
    if (!vod || typeof vod !== 'object') return vod;
    var out = {};
    Object.keys(vod).forEach(function (key) { out[key] = vod[key]; });
    var froms = vod.vod_play_from;
    var urls = vod.vod_play_url;
    if (Array.isArray(froms)) out.vod_play_from = froms.map(String).join('$$$');
    if (Array.isArray(urls)) {
      out.vod_play_url = urls.map(function (line) {
        if (Array.isArray(line)) {
          return line.map(function (episode) {
            if (episode && typeof episode === 'object') {
              return String(episode.name || '') + '$' + String(episode.id || '');
            }
            return String(episode);
          }).join('#');
        }
        return String(line);
      }).join('$$$');
    }
    return out;
  }

  function serializeList(list) {
    return asList(list).map(serializeVod);
  }

  function pageCountOf(res, fallback) {
    var value = Number(res && (res.pagecount || res.pageCount || res.size));
    return value > 0 ? value : (fallback || 1);
  }

  function normalizeList(res, requestedPage) {
    var list = serializeList(res && res.list);
    return {
      code: 1,
      msg: 'success',
      page: Number(res && res.page) || Number(requestedPage) || 1,
      pagecount: pageCountOf(res),
      limit: Number(res && res.limit) || 0,
      total: Number(res && res.total) || list.length,
      list: list
    };
  }

  // 宿主 home 的分类字段叫 classes，T4/CMS 那边叫 class。
  function normalizeHome(home) {
    home = home || {};
    var list = serializeList(home.list);
    var classes = asList(home.classes || home.class);
    return {
      code: 1,
      msg: 'success',
      class: classes,
      filters: home.filters || {},
      list: list,
      page: 1,
      pagecount: 1,
      limit: 0,
      total: list.length
    };
  }

  // 从 source.play 的返回里挑出可播地址（url 可能是字符串或数组）。
  function pickUrl(info) {
    if (!info) return '';
    var url = info.url;
    if (typeof url === 'string') return url.trim();
    if (Array.isArray(url)) {
      for (var i = 0; i < url.length; i++) {
        var item = url[i];
        if (typeof item === 'string' && /^https?:/i.test(item)) return item.trim();
      }
    }
    return '';
  }

  function normalizePlay(info, flag) {
    info = info || {};
    var url = pickUrl(info);
    if (!url) throw sourceError(new Error('宿主没有返回可播放地址'), 'NO_PLAY_URL');
    return {
      parse: String(info.parse) === '1' ? 1 : 0,
      jx: String(info.jx) === '1' ? 1 : 0,
      url: url,
      header: info.header || {},
      flag: String(info.flag || flag || '')
    };
  }

  function decodeExt(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      var raw = decodeURIComponent(String(value));
      if (raw.charAt(0) === '{') return JSON.parse(raw);
    } catch (_) {}
    try {
      var text = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      try { return JSON.parse(decodeURIComponent(escape(atob(value)))); } catch (_) { return {}; }
    }
  }

  /* ---------------- 局域网地址（与 cms-t4-bridge 同一套做法） ---------------- */

  // 局域网入口必须是私有网段：回环地址只有本机能用，宿主也只放行私有来源。
  function isLanHost(hostname) {
    var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host === '::1' || /^127\./.test(host)) return false;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return /\.local$/.test(host);
  }

  // 宿主给的地址形如 http://192.168.1.7:9321/<lanToken>；
  // 允许用户把带 /config、/health、/site/xxx 或带查询串的整段地址直接粘进来。
  function cleanLanBase(raw) {
    var value = String(raw || '').trim();
    if (!value) throw new Error('请填写局域网共享地址');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'http://' + value;
    var parsed;
    try { parsed = new URL(value); } catch (e) { throw new Error('地址不是合法 URL'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('局域网地址只支持 http 或 https');
    }
    var path = String(parsed.pathname || '').replace(/\/+$/, '');
    path = path.replace(/\/(?:api\/(?:v1\/)?)?(?:config|health)$/i, '');
    path = path.replace(/\/(?:site|s)\/[^/]+$/i, '');
    path = path.replace(/\/__service$/, '');
    return parsed.protocol + '//' + parsed.host + path.replace(/\/+$/, '');
  }

  function safeLanBase(raw) {
    if (!raw) return '';
    try { return cleanLanBase(raw); } catch (e) { return ''; }
  }

  function normalizeLan(value) {
    value = value || {};
    return {
      base: safeLanBase(value.base),
      detected: safeLanBase(value.detected),
      detectedAt: Number(value.detectedAt) || 0
    };
  }

  function readLan() {
    return ant.storage.getJSON(LAN_KEY, null).then(normalizeLan);
  }

  function writeLan(next) {
    lan = normalizeLan(next);
    return ant.storage.setJSON(LAN_KEY, { base: lan.base, detected: lan.detected, detectedAt: lan.detectedAt });
  }

  // 宿主没有读取局域网地址的 JSAPI，但局域网请求打进来时 req.url 是完整入口，
  // 而 req.path 已经剥掉了前缀；两者相减就是 http://IP:9321/<lanToken>。
  function lanBaseFromRequest(req) {
    var headers = (req && req.headers) || {};
    var forwarded = headers['X-Ant-Lan-Base'] || headers['x-ant-lan-base'];
    if (forwarded) {
      var forwardedBase = safeLanBase(forwarded);
      if (forwardedBase) return forwardedBase;
    }
    var raw = req && req.url;
    if (!raw) return '';
    var parsed;
    try { parsed = new URL(String(raw)); } catch (e) { return ''; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!isLanHost(parsed.hostname)) return '';
    var full = String(parsed.pathname || '/');
    var path = String((req && req.path) || '/');
    var prefix = full;
    if (path !== '/' && full.length >= path.length && full.slice(full.length - path.length) === path) {
      prefix = full.slice(0, full.length - path.length);
    }
    prefix = prefix.replace(/\/+$/, '').replace(/\/__service$/, '');
    return prefix ? parsed.protocol + '//' + parsed.host + prefix : '';
  }

  function requestFromLan(req) {
    if (lanBaseFromRequest(req)) return true;
    var headers = (req && req.headers) || {};
    var host = headers.host || headers.Host || headers['x-forwarded-host'] || headers['X-Forwarded-Host'];
    return !!host && isLanHost(String(host).replace(/:\d+$/, ''));
  }

  // 后台拉起时内存里的 lan 可能还没读出来，所以读一遍存储再写，别覆盖手填的地址。
  function rememberLanBase(req) {
    var found = lanBaseFromRequest(req);
    if (!found) return;
    readLan().then(function (value) {
      if (value.detected === found) { lan = value; return null; }
      return writeLan({ base: value.base, detected: found, detectedAt: Date.now() }).then(function () {
        if (linkList) paintExport();
      });
    }).catch(function () {});
  }

  function effectiveLanBase() { return lan.base || lan.detected || ''; }

  function isInternalBase(base) { return String(base).indexOf('miniapp://') === 0; }

  // miniapp:// 后面直接跟查询串，http 地址要保留目录斜杠。
  function joinPath(base, path) {
    if (path === '/') return isInternalBase(base) ? base : base + '/';
    return base + path;
  }

  // 站点走路径而不是查询串：T4 调用方会往 api 后面直接接 `?ac=…`，
  // 给出 `?site=` 形式的地址会拼成两个问号。查询串形式仍然照旧受理。
  function siteApi(base, key) {
    return joinPath(base, '/site/' + encodeURIComponent(key));
  }

  function descriptor(list, base) {
    return {
      sites: list.map(function (site) {
        return {
          key: site.key,
          name: site.name || site.key,
          type: 4,
          api: siteApi(base, site.key),
          searchable: site.searchable ? 1 : 0,
          quickSearch: site.searchable ? 1 : 0,
          filterable: 1
        };
      })
    };
  }

  function resolveApiBase(req, lanRecord) {
    var params = (req && req.params) || {};
    var raw = String(params.base || params.apiBase || '').trim();
    if (/^miniapp:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    var explicit = safeLanBase(raw);
    if (explicit) return explicit;
    var detected = lanBaseFromRequest(req);
    if (detected) return detected;
    var stored = (lanRecord && (lanRecord.base || lanRecord.detected)) || '';
    if (stored && requestFromLan(req)) return stored;
    return INTERNAL_BASE;
  }

  /* ---------------- 反向服务 ---------------- */

  // site 既可以走查询串，也可以走 /site/<key> 路径——有些调用方会吞掉查询串。
  function siteKeyFromRequest(req) {
    var fromParams = String((req && req.params && req.params.site) || '').trim();
    if (fromParams) return fromParams;
    var matched = String((req && req.path) || '').match(/^\/(?:site|s)\/([^/?#]+)/);
    return matched ? decodeURIComponent(matched[1]) : '';
  }

  function businessPath(req) {
    var path = String((req && req.path) || '/').replace(/^\/(?:site|s)\/[^/?#]+/, '');
    return path || '/';
  }

  function handleSite(site, req) {
    var params = req.params || {};
    var page = Number(params.pg) || 1;

    // 播放：统一走 source.play——CMS 源原样回显，爬虫源由宿主解析。
    if (params.play !== undefined && String(params.play) !== '') {
      return enqueue(function () {
        return ant.source.play({
          siteKey: site.key,
          flag: String(params.flag || ''),
          id: String(params.play)
        });
      }).then(function (info) {
        return jsonResponse(normalizePlay(info, params.flag));
      });
    }

    if (params.wd !== undefined && String(params.wd) !== '') {
      if (!site.searchable) {
        return Promise.resolve(errorResponse('NOT_SEARCHABLE', '这个采集源不支持搜索: ' + site.key, 400));
      }
      return enqueue(function () {
        return ant.source.search({ siteKey: site.key, wd: String(params.wd), page: page });
      }).then(function (res) {
        return jsonResponse(normalizeList(res, page));
      });
    }

    var ac = String(params.ac || '').toLowerCase();
    if (ac === 'detail' && params.ids !== undefined && String(params.ids) !== '') {
      // 多个 ID 逐个取详情再合并；宿主的 detail 只收单个 id。
      var ids = String(params.ids).split(',').map(function (id) {
        return id.trim();
      }).filter(Boolean);
      var merged = [];
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return enqueue(function () {
            return ant.source.detail({ siteKey: site.key, id: id });
          }).then(function (res) {
            Array.prototype.push.apply(merged, serializeList(res && res.list));
          });
        });
      });
      return chain.then(function () {
        return jsonResponse({
          code: 1,
          msg: 'success',
          page: 1,
          pagecount: 1,
          limit: 0,
          total: merged.length,
          list: merged
        });
      });
    }

    if (params.t !== undefined && String(params.t) !== '') {
      return enqueue(function () {
        return ant.source.category({
          siteKey: site.key,
          tid: String(params.t),
          page: page,
          ext: decodeExt(params.ext)
        });
      }).then(function (res) {
        return jsonResponse(normalizeList(res, page));
      });
    }

    // 首页：filter 参数只是 T4 的约定，宿主 home 一次给全。
    return enqueue(function () {
      return ant.source.home(site.key);
    }).then(function (home) {
      return jsonResponse(normalizeHome(home));
    });
  }

  function handleService(req) {
    rememberLanBase(req);
    return Promise.all([listSites(false), readLan()]).then(function (loaded) {
      var list = loaded[0];
      var lanRecord = loaded[1];
      var path = businessPath(req);
      if (path === '/health' || path === '/api/health') {
        return jsonResponse({ code: 0, msg: 'ok', data: {
          appId: APP_ID,
          sources: list.length,
          defaultSite: defaultKey || (list[0] ? list[0].key : ''),
          siteKeys: list.map(function (site) { return site.key; })
        } });
      }
      if (path === '/config' || path === '/api/config' || path === '/api/v1/config') {
        return jsonResponse(descriptor(list, resolveApiBase(req, lanRecord)));
      }
      if (!list.length) {
        return errorResponse('NO_SOURCES', '宿主里还没有配置采集源，请先在宿主的影视模块添加', 503);
      }
      var requested = siteKeyFromRequest(req);
      var site = selectSite(list, requested);
      if (!site) {
        return errorResponse('SITE_NOT_FOUND', '找不到采集源: ' + (requested || '(默认)'), 404);
      }
      return handleSite(site, req);
    }).catch(function (error) {
      var e = sourceError(error);
      var message = e.message || String(error);
      if (e.code === 'UNAVAILABLE') {
        return errorResponse(e.code, '宿主影视模块未就绪，稍后再试', 503);
      }
      return errorResponse(e.code, message, 502);
    });
  }

  // 先注册服务，再读配置；后台拉起时没有 DOM 也能正常处理请求。
  ant.serve(handleService);

  /* ---------------- 页面渲染 ---------------- */

  var TYPE_NAMES = { 0: 'XML', 1: 'CMS', 3: '爬虫', 4: 'T4' };

  function typeLabel(type) {
    var value = Number(type);
    return TYPE_NAMES[value] || ('type ' + type);
  }

  function paintSites() {
    siteListEl.innerHTML = '';
    if (!sites.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '宿主里还没有采集源。去宿主的影视模块添加配置源，回来点「刷新列表」。';
      siteListEl.appendChild(empty);
      return;
    }
    sites.forEach(function (site) {
      var item = document.createElement('div');
      item.className = 'site-item' + (site.key === defaultKey ? ' selected' : '');
      item.innerHTML = '<div class="site-meta"><strong></strong><span></span><code></code></div>' +
        '<div class="site-actions"><button data-key="default">' +
        (site.key === defaultKey ? '默认站点' : '设为默认') + '</button></div>';
      item.querySelector('strong').textContent = site.name || site.key;
      item.querySelector('span').textContent =
        'key: ' + site.key + ' · ' + typeLabel(site.type) +
        (site.searchable ? ' · 可搜索' : ' · 不可搜索') +
        (site.key === defaultKey ? ' · 当前默认' : '');
      item.querySelector('code').textContent = siteApi(INTERNAL_BASE, site.key);
      item.querySelector('[data-key="default"]').addEventListener('click', function () {
        writeDefaultKey(site.key).then(function () {
          paint();
          setStatus('已设为默认站点：' + (site.name || site.key), 'ok');
        }).catch(function (e) {
          setStatus('保存失败：' + ((e && e.message) || e), 'error');
        });
      });
      siteListEl.appendChild(item);
    });
  }

  function linkRow(row) {
    var item = document.createElement('div');
    item.className = 'link-item';
    var meta = document.createElement('div');
    meta.className = 'link-meta';
    var label = document.createElement('strong');
    label.textContent = row.label;
    meta.appendChild(label);
    if (row.hint) {
      var hint = document.createElement('span');
      hint.textContent = row.hint;
      meta.appendChild(hint);
    }
    var code = document.createElement('code');
    code.textContent = row.url;
    meta.appendChild(code);
    var button = document.createElement('button');
    button.className = 'copy';
    button.textContent = '复制';
    button.setAttribute('data-focus', '');
    button.addEventListener('click', function () { copyText(row.url, row.label + '地址'); });
    item.appendChild(meta);
    item.appendChild(button);
    return item;
  }

  function paintExport() {
    var isLan = scope === 'lan';
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-scope') === scope;
      tab.className = 'tab' + (active ? ' is-active' : '');
    });
    lanForm.hidden = !isLan;
    linkList.innerHTML = '';

    var base = isLan ? effectiveLanBase() : INTERNAL_BASE;
    if (!base) {
      activeConfigUrl = '';
      configUrl.textContent = '未设置局域网地址';
      prefixSample.textContent = 'http://192.168.1.7:9321/lanToken';
      scopeHint.textContent = '在宿主里开启局域网共享，把地址填到下面即可；别的设备访问过一次后页面也会自己认出来。';
      output.textContent = '设置局域网地址后，这里给出可直接导入第三方播放器的配置 JSON。';
      return;
    }

    activeConfigUrl = joinPath(base, '/config');
    configUrl.textContent = activeConfigUrl;
    prefixSample.textContent = base;
    scopeHint.textContent = isLan
      ? (lan.base ? '手动填写的地址' : '自动识别的地址（来自最近一次局域网请求）') + '，同一网络里的设备和第三方播放器可直接用；token 泄露等于把服务交出去。'
      : '宿主内部地址，供宿主自己的设置项和其它小程序引用；出了这台设备用不了，给别的设备请切到局域网。';

    if (!sites.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '宿主里还没有采集源，此时 config 接口返回空的 sites。';
      linkList.appendChild(empty);
    } else {
      linkList.appendChild(linkRow({
        label: '默认站点',
        hint: '省略 site 参数，走小程序里设为默认的站点',
        url: joinPath(base, '/')
      }));
      sites.forEach(function (site) {
        linkList.appendChild(linkRow({
          label: site.name || site.key,
          hint: 'key: ' + site.key + (site.key === defaultKey ? ' · 默认' : '') + ' · 后面可直接接 ?ac=…',
          url: siteApi(base, site.key)
        }));
      });
    }
    linkList.appendChild(linkRow({
      label: '健康检查',
      hint: '确认服务在线与站点数量',
      url: joinPath(base, '/health')
    }));
    output.textContent = JSON.stringify(descriptor(sites, base), null, 2);
  }

  function paint() {
    paintSites();
    paintExport();
  }

  function loadSites(force, silent) {
    return listSites(force).then(function (list) {
      return readDefaultKey().then(function () {
        paint();
        if (!silent) {
          if (list.length) setStatus('已加载 ' + list.length + ' 个采集源，T4 服务运行中。', 'ok');
          else setStatus('宿主里还没有采集源，先去宿主的影视模块添加。');
        }
      });
    }).catch(function (e) {
      paint();
      setStatus('读取采集源失败：' + ((e && e.message) || e), 'error');
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  document.getElementById('refresh').addEventListener('click', function () {
    setStatus('正在刷新采集源列表…');
    loadSites(true, false);
  });

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      scope = tab.getAttribute('data-scope') === 'lan' ? 'lan' : 'internal';
      setExportStatus('');
      paintExport();
    });
  });

  document.getElementById('copy-config-url').addEventListener('click', function () {
    copyText(activeConfigUrl, 'config 接口');
  });

  document.getElementById('copy').addEventListener('click', function () {
    if (!sites.length) { setExportStatus('宿主里还没有采集源。', 'error'); return; }
    if (scope === 'lan' && !effectiveLanBase()) { setExportStatus('请先设置局域网地址。', 'error'); return; }
    copyText(output.textContent, '配置 JSON');
  });

  document.getElementById('lan-save').addEventListener('click', function () {
    var base;
    try { base = cleanLanBase(lanInput.value); }
    catch (e) { setExportStatus(e.message, 'error'); return; }
    var parsed = new URL(base);
    writeLan({ base: base, detected: lan.detected, detectedAt: lan.detectedAt }).then(function () {
      lanInput.value = base;
      scope = 'lan';
      paintExport();
      if (!isLanHost(parsed.hostname)) {
        setExportStatus('已保存，但这不像局域网地址，别的设备可能连不上。', 'error');
      } else if (!String(parsed.pathname || '').replace(/\/+$/, '')) {
        setExportStatus('已保存，但地址里缺少 token 段，请从宿主整段复制。', 'error');
      } else {
        setExportStatus('局域网地址已保存。', 'ok');
      }
    }).catch(function (e) { setExportStatus('保存失败：' + ((e && e.message) || e), 'error'); });
  });

  document.getElementById('lan-clear').addEventListener('click', function () {
    writeLan({ base: '', detected: lan.detected, detectedAt: lan.detectedAt }).then(function () {
      lanInput.value = '';
      paintExport();
      setExportStatus(lan.detected ? '已清除手填地址，改用自动识别的地址。' : '已清除局域网地址。');
    }).catch(function (e) { setExportStatus('清除失败：' + ((e && e.message) || e), 'error'); });
  });

  ant.tv.onKey(function (event) {
    var items = Array.prototype.slice.call(document.querySelectorAll('input, button:not([disabled])'));
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') index = (index + 1) % items.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') index = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === 'Enter' || event.key === 'Select') { if (document.activeElement) document.activeElement.click(); return; }
    else return;
    items[index].focus();
    if (items[index].scrollIntoView) items[index].scrollIntoView({ block: 'nearest' });
  });

  // 回到前台时重读一次：局域网地址可能是后台请求进来时才认出来的，
  // 宿主里的采集源配置也可能刚被用户改过。
  ant.onShow(function () {
    readLan().then(function (value) {
      lan = value;
      if (!lanInput.value) lanInput.value = lan.base;
      return loadSites(true, true);
    }).catch(function () {});
  });

  Promise.all([readLan(), readDefaultKey()]).then(function (loaded) {
    lan = loaded[0];
    lanInput.value = lan.base;
    return loadSites(false, false);
  });
})();
