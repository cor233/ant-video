/*
 * migu.js — 咪咕直播 浏览器版取流逻辑（游客 720p/高清模式）
 *
 * 从 server/source 的 Node 实现移植而来，改用 ant.request（真机不受 CORS 限制）：
 *   - fetchCategories / fetchChannels : 咪咕公开的直播分类与频道接口
 *   - resolvePlayUrl                  : getAndroidURL720p + getddCalcuURL720p
 *   - md5                             : 纯 JS 实现，替代 Node 的 crypto
 *
 * 只依赖 MD5 与字符串拼接，不碰 AES/RSA/WASM。挂到 window.MiguLive。
 */
(function () {
  'use strict';

  // ---- 移动端 UA，与 Node 版 net.js 保持一致 ----
  var MOBILE_UA =
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  // ---- 画质开关，对齐 config.js 默认值 ----
  var ENABLE_HDR = true;
  var ENABLE_H265 = true;

  // ==========================================================================
  // MD5（纯 JS，输出小写十六进制），等价于 crypto.createHash('md5')
  // 经典公开实现（Joseph Myers 风格），对 UTF-8 字符串取哈希。
  // ==========================================================================
  function md5(inputStr) {
    var str = utf8Encode(inputStr);
    var x = strToBlocks(str);
    var len = str.length * 8;
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;

    for (var i = 0; i < x.length; i += 16) {
      var oa = a, ob = b, oc = c, od = d;

      a = ff(a, b, c, d, x[i + 0], 7, -680876936);
      d = ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10], 17, -42063);
      b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = gg(b, c, d, a, x[i + 0], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = hh(a, b, c, d, x[i + 5], 4, -378558);
      d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = hh(d, a, b, c, x[i + 0], 11, -358537222);
      c = hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = ii(a, b, c, d, x[i + 0], 6, -198630844);
      d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = add(a, oa);
      b = add(b, ob);
      c = add(c, oc);
      d = add(d, od);
    }
    return rhex(a) + rhex(b) + rhex(c) + rhex(d);
  }

  function cmn(q, a, b, x, s, t) {
    return add(rol(add(add(a, q), add(x, t)), s), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

  function add(x, y) {
    var lsw = (x & 0xffff) + (y & 0xffff);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }

  function strToBlocks(str) {
    var blocks = [];
    for (var i = 0; i < str.length * 8; i += 8) {
      blocks[i >> 5] |= (str.charCodeAt(i / 8) & 0xff) << (i % 32);
    }
    return blocks;
  }

  var HEX = '0123456789abcdef';
  function rhex(num) {
    var s = '';
    for (var j = 0; j < 4; j++) {
      s += HEX.charAt((num >> (j * 8 + 4)) & 0x0f) + HEX.charAt((num >> (j * 8)) & 0x0f);
    }
    return s;
  }

  // 把字符串按 UTF-8 展开成单字节字符串，保证与 Node 的 md5.update(str) 一致
  function utf8Encode(str) {
    return unescape(encodeURIComponent(str));
  }

  // ==========================================================================
  // 网络：统一走 ant.request（真机不受 CORS 限制），返回解析后的 JSON
  // ==========================================================================
  function requestJson(url, extraHeaders) {
    var headers = { 'User-Agent': MOBILE_UA };
    if (extraHeaders) {
      for (var k in extraHeaders) {
        if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k];
      }
    }
    return ant.request({ url: url, method: 'GET', headers: headers, timeout: 12000 })
      .then(function (res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          var e = new Error('HTTP ' + res.statusCode);
          e.code = 'HTTP_' + res.statusCode;
          throw e;
        }
        try {
          return JSON.parse(res.data);
        } catch (err) {
          var e2 = new Error('返回内容不是合法 JSON');
          e2.code = 'BAD_JSON';
          throw e2;
        }
      });
  }

  // ==========================================================================
  // 日期串：等价于 Node 版 time.js 的 getDateString → yyyyMMdd
  // ==========================================================================
  function getDateString(date) {
    return (
      date.getFullYear() +
      pad2(date.getMonth() + 1) +
      pad2(date.getDate())
    );
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  // ==========================================================================
  // 分类与频道列表（移植 fetchList.js 的 cateList / dataList）
  // ==========================================================================
  var TV_DATA_BASE = 'https://program-sc.miguvideo.com/live/v2/tv-data/';
  var ROOT_VOMS = '1ff892f2b5ab4a79be6e25b69d2f5d05';

  // 返回分类数组：[{ name, vomsID, fitArea }]，央视排首位、去掉“热门”
  function fetchCategories() {
    return requestJson(TV_DATA_BASE + ROOT_VOMS).then(function (resp) {
      if (!resp || !resp.body || !resp.body.liveList) return [];
      var list = resp.body.liveList.filter(function (item) {
        return item.name !== '热门';
      });
      list.sort(function (a, b) {
        if (a.name === '央视') return -1;
        if (b.name === '央视') return 1;
        return 0;
      });
      return list;
    });
  }

  // 拉某个分类下的频道：[{ name, pID, pics:{highResolutionH}, ... }]
  function fetchChannels(vomsID) {
    return requestJson(TV_DATA_BASE + vomsID).then(function (resp) {
      if (!resp || !resp.body || !resp.body.dataList) return [];
      return resp.body.dataList;
    });
  }

  // ==========================================================================
  // 取流：getAndroidURL720p（游客高清）→ getddCalcuURL720p
  // ==========================================================================
  var CLIENT_ID = md5(String(Date.now()));
  var PLAY_BASE = 'https://play.miguvideo.com/playurl/v1/play/playurl';
  // cctv5 / cctv5+ 开启 flv 后不能回放，这两个 pid 不带 appCode
  var NO_APPCODE_PIDS = { '641886683': 1, '641886773': 1 };

  function getddCalcu720p(puData, programId) {
    if (puData == null || programId == null) return '';
    var keys = 'cdabyzwxkl';
    var out = [];
    var half = puData.length / 2;
    for (var i = 0; i < half; i++) {
      out.push(puData[puData.length - i - 1]);
      out.push(puData[i]);
      switch (i) {
        case 1:
          out.push('v');
          break;
        case 2:
          out.push(keys[parseInt(getDateString(new Date())[2], 10)]);
          break;
        case 3:
          out.push(keys[programId[6]]);
          break;
        case 4:
          out.push('a');
          break;
      }
    }
    return out.join('');
  }

  function getddCalcuURL720p(puDataURL, programId) {
    if (puDataURL == null || programId == null) return '';
    var puData = puDataURL.split('&puData=')[1];
    var ddCalcu = getddCalcu720p(puData, programId);
    return puDataURL + '&ddCalcu=' + ddCalcu + '&sv=10004&ct=android';
  }

  /**
   * 解析频道播放地址（游客高清）。
   * @param {string} pid 频道 pID
   * @returns {Promise<string>} 可直接交给 ant.player.open 的播放地址
   */
  function resolvePlayUrl(pid) {
    pid = String(pid);
    var timestamp = String(Math.round(Date.now()));
    var appVersion = '2600034600';
    var appVersionID = appVersion + '-99000-201600010010028';

    var headers = {
      AppVersion: appVersion,
      TerminalId: 'android',
      'X-UP-CLIENT-CHANNEL-ID': appVersionID,
      ClientId: CLIENT_ID
    };
    if (!NO_APPCODE_PIDS[pid]) {
      headers.appCode = 'miguvideo_default_android';
    }

    var str = timestamp + pid + appVersion.substring(0, 8);
    var md5str = md5(str);

    var salt = String(Math.floor(Math.random() * 1000000)).padStart(6, '0') + '25';
    var suffix = '2cac4f2c6c3346a5b34e085725ef7e33migu' + salt.substring(0, 4);
    var sign = md5(md5str + suffix);

    var rateType = 3;
    var hdr = ENABLE_HDR ? '&4kvivid=true&2Kvivid=true&vivid=2' : '';
    var h265 = ENABLE_H265 ? '&h265N=true' : '';

    var params =
      '?sign=' + sign +
      '&rateType=' + rateType +
      '&contId=' + pid +
      '&timestamp=' + timestamp +
      '&salt=' + salt +
      '&flvEnable=true&super4k=true' + h265 + hdr;

    return requestJson(PLAY_BASE + params, headers).then(function (respData) {
      var url = respData && respData.body && respData.body.urlInfo && respData.body.urlInfo.url;
      if (!url) {
        var msg = (respData && respData.body && respData.body.auth && respData.body.auth.resultDesc) ||
          (respData && respData.message) || '节目调整，暂不提供服务';
        var e = new Error(msg);
        e.code = 'NO_URL';
        throw e;
      }
      var contId = (respData.body.content && respData.body.content.contId) || pid;
      return getddCalcuURL720p(url, String(contId));
    });
  }

  window.MiguLive = {
    md5: md5,
    getDateString: getDateString,
    fetchCategories: fetchCategories,
    fetchChannels: fetchChannels,
    resolvePlayUrl: resolvePlayUrl,
    MOBILE_UA: MOBILE_UA
  };
})();
