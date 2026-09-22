/*
 * app.js — 咪咕直播 UI 交互
 *   分类 tab → 频道网格 → 点击 ant.player.open 播放
 *   状态：骨架 / 空 / 失败重试；ant.storage 记住上次分类；TV 遥控焦点
 */
(function () {
  'use strict';

  var Migu = window.MiguLive;
  var STORE_KEY = 'migu_live_last_cate';

  var tabsEl = document.getElementById('tabs');
  var gridEl = document.getElementById('grid');
  var mainEl = document.getElementById('main');

  var categories = [];         // [{name, vomsID}]
  var activeIndex = 0;
  var channelCache = {};       // vomsID -> channel[]
  var reqSeq = 0;              // 防止分类快速切换时旧结果覆盖新结果

  // ---------------------------------------------------------------- 工具
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    if (window.ant && ant.ui && ant.ui.toast) return ant.ui.toast(msg).catch(function () {});
    return Promise.resolve();
  }
  function logoUrl(ch) {
    return (ch && ch.pics && (ch.pics.highResolutionH || ch.pics.lowResolutionH || ch.pics.highResolutionV)) || '';
  }

  // ---------------------------------------------------------------- 渲染：状态
  function renderState(icon, title, desc, retryFn) {
    gridEl.innerHTML = '';
    gridEl.style.display = 'block';
    var box = document.createElement('div');
    box.className = 'state';
    box.innerHTML =
      '<div class="icon">' + icon + '</div>' +
      '<h3>' + esc(title) + '</h3>' +
      '<p>' + esc(desc) + '</p>';
    if (retryFn) {
      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.setAttribute('data-focus', '');
      btn.textContent = '重试';
      btn.addEventListener('click', retryFn);
      box.appendChild(btn);
    }
    gridEl.appendChild(box);
    refreshFocusables();
  }

  function renderSkeleton(n) {
    gridEl.style.display = 'grid';
    var html = '';
    for (var i = 0; i < n; i++) html += '<div class="skel"></div>';
    gridEl.innerHTML = html;
  }

  // ---------------------------------------------------------------- 渲染：tab
  function renderTabs() {
    tabsEl.innerHTML = '';
    categories.forEach(function (cate, i) {
      var el = document.createElement('button');
      el.className = 'tab' + (i === activeIndex ? ' active' : '');
      el.textContent = cate.name;
      el.setAttribute('data-focus', '');
      el.addEventListener('click', function () { selectCategory(i); });
      tabsEl.appendChild(el);
    });
    refreshFocusables();
  }

  function markActiveTab() {
    var tabs = tabsEl.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', i === activeIndex);
    }
    var active = tabs[activeIndex];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  // ---------------------------------------------------------------- 渲染：网格
  function renderChannels(list) {
    if (!list || !list.length) {
      renderState('📭', '这个分类暂时没有频道', '换个分类看看，或稍后重试。');
      return;
    }
    gridEl.style.display = 'grid';
    var frag = document.createDocumentFragment();
    list.forEach(function (ch) {
      if (!ch || !ch.pID) return;
      var card = document.createElement('button');
      card.className = 'card';
      card.setAttribute('data-focus', '');
      var url = logoUrl(ch);
      var initial = esc((ch.name || '?').trim().charAt(0));
      card.innerHTML =
        '<span class="live-badge"><i></i>LIVE</span>' +
        '<span class="logo-box">' +
          (url
            ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<span class=&quot;logo-fallback&quot;>' + initial + '</span>\'"/>'
            : '<span class="logo-fallback">' + initial + '</span>') +
        '</span>' +
        '<span class="name">' + esc(ch.name) + '</span>';
      card.addEventListener('click', function () { play(ch); });
      frag.appendChild(card);
    });
    gridEl.innerHTML = '';
    gridEl.appendChild(frag);
    mainEl.scrollTop = 0;
    refreshFocusables();
  }

  // ---------------------------------------------------------------- 播放
  var playing = false;
  function play(ch) {
    if (playing) return;
    playing = true;
    ant.ui.loading('正在获取「' + (ch.name || '频道') + '」…');
    Migu.resolvePlayUrl(ch.pID)
      .then(function (url) {
        return ant.ui.hideLoading().then(function () {
          return ant.player.open({
            url: url,
            title: ch.name || '咪咕直播',
            headers: { 'User-Agent': Migu.MOBILE_UA }
          });
        });
      })
      .catch(function (e) {
        return ant.ui.hideLoading().then(function () {
          toast('播放失败：' + (e && e.message ? e.message : '未知错误'));
        });
      })
      .then(function () { playing = false; }, function () { playing = false; });
  }

  // ---------------------------------------------------------------- 数据流
  function selectCategory(i) {
    if (i < 0 || i >= categories.length) return;
    activeIndex = i;
    markActiveTab();
    var cate = categories[i];
    ant.storage.set(STORE_KEY, cate.vomsID).catch(function () {});

    var seq = ++reqSeq;
    if (channelCache[cate.vomsID]) {
      renderChannels(channelCache[cate.vomsID]);
      return;
    }
    renderSkeleton(9);
    Migu.fetchChannels(cate.vomsID)
      .then(function (list) {
        if (seq !== reqSeq) return; // 已切到别的分类
        channelCache[cate.vomsID] = list;
        renderChannels(list);
      })
      .catch(function (e) {
        if (seq !== reqSeq) return;
        renderState('⚠️', '频道加载失败', (e && e.message) || '网络异常', function () { selectCategory(i); });
      });
  }

  function boot() {
    renderSkeleton(9);
    Promise.all([
      Migu.fetchCategories(),
      ant.storage.get(STORE_KEY).catch(function () { return null; })
    ]).then(function (arr) {
      var cates = arr[0];
      var lastVoms = arr[1];
      if (!cates || !cates.length) {
        renderState('📡', '暂时拉不到直播分类', '可能是网络或地域限制，请稍后重试。', boot);
        return;
      }
      categories = cates;
      activeIndex = 0;
      if (lastVoms) {
        for (var i = 0; i < cates.length; i++) {
          if (cates[i].vomsID === lastVoms) { activeIndex = i; break; }
        }
      }
      renderTabs();
      selectCategory(activeIndex);
    }).catch(function (e) {
      renderState('⚠️', '加载失败', (e && e.message) || '网络异常', boot);
    });
  }

  // ---------------------------------------------------------------- TV 遥控焦点
  var focusables = [];
  var focusIdx = -1;
  function refreshFocusables() {
    focusables = Array.prototype.slice.call(document.querySelectorAll('[data-focus]'));
    if (focusIdx >= focusables.length) focusIdx = focusables.length - 1;
  }
  function setFocus(idx) {
    if (!focusables.length) return;
    if (focusIdx >= 0 && focusables[focusIdx]) focusables[focusIdx].classList.remove('kb-focus');
    focusIdx = Math.max(0, Math.min(idx, focusables.length - 1));
    var el = focusables[focusIdx];
    if (el) {
      el.classList.add('kb-focus');
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function columnsInGrid() {
    var cards = gridEl.querySelectorAll('.card');
    if (cards.length < 2) return 1;
    var top0 = cards[0].offsetTop;
    var cols = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].offsetTop === top0) cols++; else break;
    }
    return cols || 1;
  }
  function handleKey(key) {
    if (!focusables.length) refreshFocusables();
    if (!focusables.length) return false;
    if (focusIdx < 0) { setFocus(0); return true; }

    var cur = focusables[focusIdx];
    var isCard = cur && cur.classList.contains('card');
    var cols = isCard ? columnsInGrid() : 1;

    switch (key) {
      case 'ArrowRight': setFocus(focusIdx + 1); return true;
      case 'ArrowLeft': setFocus(focusIdx - 1); return true;
      case 'ArrowDown': setFocus(focusIdx + (isCard ? cols : 1)); return true;
      case 'ArrowUp': setFocus(focusIdx - (isCard ? cols : 1)); return true;
      case 'Enter':
      case 'Select':
        if (cur) cur.click();
        return true;
      default:
        return false;
    }
  }

  if (window.ant && ant.tv && ant.tv.onKey) {
    ant.tv.onKey(function (ev) {
      var key = ev && (ev.key || ev.keyName || ev.code);
      return handleKey(key);
    });
  }
  // 浏览器里也能用方向键预览焦点行为
  window.addEventListener('keydown', function (ev) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].indexOf(ev.key) === -1) return;
    if (handleKey(ev.key)) ev.preventDefault();
  });

  // 从播放页返回时不需要重拉，缓存还在
  if (window.ant && ant.onShow) ant.onShow(function () {});

  boot();
})();
