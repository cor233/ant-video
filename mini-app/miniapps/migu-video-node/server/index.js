const http = require('http');
const path = require('path');

let server = null;
let updateTimer = null;
let loading = false;
let hours = 0;
let runtime = null;

function applyConfig(config) {
  const sourceDir = path.join(__dirname, 'source');
  process.env.MIGU_DATA_DIR = sourceDir;
  process.env.mport = String(process.env.DEV_HTTP_PORT || '0');
  process.env.mhost = '';

  Object.entries(config || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      delete process.env[key];
      return;
    }
    process.env[key] = String(value);
  });
}

async function loadRuntime() {
  if (runtime) return runtime;
  const [{ default: update }, appUtils, time, fetchList, colors, config] =
    await Promise.all([
      import('./source/utils/updateData.js'),
      import('./source/utils/appUtils.js'),
      import('./source/utils/time.js'),
      import('./source/utils/fetchList.js'),
      import('./source/utils/colorOut.js'),
      import('./source/config.js'),
    ]);
  runtime = {
    update,
    channel: appUtils.channel,
    interfaceStr: appUtils.interfaceStr,
    getDateTimeStr: time.getDateTimeStr,
    delay: fetchList.delay,
    printBlue: colors.printBlue,
    printGreen: colors.printGreen,
    printMagenta: colors.printMagenta,
    printRed: colors.printRed,
    pass: config.pass,
    token: config.token,
    userId: config.userId,
    updateInterval: config.programInfoUpdateInterval,
  };
  return runtime;
}

function send(res, status, body, contentType = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(body);
}

async function requestHandler(req, res) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/check') {
    send(res, 200, JSON.stringify({ ok: true, service: 'migu-video' }));
    return;
  }
  if (pathname === '/status') {
    send(res, 200, JSON.stringify({ ok: true, updating: loading, hours }));
    return;
  }

  const svc = await loadRuntime();
  while (loading) await svc.delay(50);
  loading = true;

  try {
    let { method, url, headers } = req;

    if (svc.pass !== '') {
      const urlSplit = url.split('/');
      if (urlSplit[1] !== svc.pass) {
        svc.printRed('身份认证失败');
        send(res, 200, '身份认证失败', 'text/plain; charset=utf-8');
        return;
      }
      url = urlSplit.length > 3
        ? url.substring(svc.pass.length + 1)
        : (urlSplit.length === 2 ? '/' : '/' + urlSplit[urlSplit.length - 1]);
    }

    let urlToken = '';
    let urlUserId = '';
    if (/\/{1}[^\/\s]{1,}\/{1}[^\/\s]{1,}/.test(url)) {
      const urlSplit = url.split('/');
      if (urlSplit.length >= 3) {
        urlUserId = urlSplit[1];
        urlToken = urlSplit[2];
        url = urlSplit.length === 3 ? '/' : '/' + urlSplit[urlSplit.length - 1];
      }
    } else {
      urlUserId = svc.userId;
      urlToken = svc.token;
    }

    svc.printMagenta('请求地址：' + url);

    if (method === 'HEAD') {
      send(res, 200, '');
      return;
    }
    if (method !== 'GET') {
      send(res, 200, JSON.stringify({ data: '请使用GET请求' }));
      svc.printRed(`使用非GET请求:${method}`);
      return;
    }

    const interfaceList = new Set([
      '/', '/interface.txt', '/m3u', '/txt', '/playback.xml', '/main.m3u',
    ]);
    const requestPath = new URL(url, 'http://127.0.0.1').pathname;
    if (interfaceList.has(requestPath)) {
      const interfaceObj = svc.interfaceStr(requestPath, headers, urlUserId, urlToken);
      const extraHeaders = requestPath === '/m3u'
        ? { 'Content-Disposition': 'inline; filename="interface.m3u"' }
        : {};
      send(
        res,
        200,
        interfaceObj.content == null ? '获取失败' : interfaceObj.content,
        interfaceObj.contentType,
        extraHeaders,
      );
      return;
    }

    const result = await svc.channel(url, urlUserId, urlToken);
    if (result.code !== 302) {
      svc.printRed(result.desc);
      send(res, result.code, result.desc, 'text/plain; charset=utf-8');
      return;
    }
    send(res, 302, '', 'text/plain; charset=utf-8', { Location: result.playURL });
  } catch (error) {
    console.error('[migu-video] 请求处理失败', error);
    if (!res.headersSent) {
      send(res, 500, JSON.stringify({ error: '服务异常' }));
    } else {
      res.end();
    }
  } finally {
    loading = false;
  }
}

async function updateData() {
  const svc = await loadRuntime();
  try {
    svc.printBlue(`准备更新文件 ${svc.getDateTimeStr(new Date())}`);
    await svc.update(hours);
  } catch (error) {
    console.error('[migu-video] 更新失败', error);
    svc.printRed('更新失败');
  }
}

module.exports = {
  start(config) {
    if (server) return;
    applyConfig(config);
    const factory = globalThis.catServerFactory || http.createServer;
    server = globalThis.catServerFactory
      ? factory(requestHandler)
      : http.createServer(requestHandler);
    server.listen(Number(process.env.DEV_HTTP_PORT), '127.0.0.1', async () => {
      const svc = await loadRuntime();
      const intervalHours = Math.max(1, Number.parseInt(svc.updateInterval, 10) || 6);
      svc.printGreen(`咪咕 Node 小程序服务已启动，端口 ${process.env.DEV_HTTP_PORT}`);
      void updateData();
      updateTimer = setInterval(() => {
        hours += intervalHours;
        void updateData();
      }, intervalHours * 60 * 60 * 1000);
    });
  },

  stop() {
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = null;
    if (server) server.close();
    server = null;
    loading = false;
  },
};
