/*!
 * miniapp-node/service/entry.js —— Node 型小程序的 esbuild 入口。
 *
 * 和 WebView 版的 entry.js 是同一个业务的两种宿主形态，差别只在运行时：
 *   - WebView 版：没有 node，靠 runtime-polyfill + ant.serve（宿主转发请求进来）
 *   - Node 版（本文件）：真 node，自己监听端口，宿主用 http 直接打进来
 *
 * 所以这里要做的只有一件事：把 node 的 IncomingMessage/ServerResponse
 * 翻译成 worker.js 认得的 Request/Response。
 */
import http from 'http';
// danmu_api 的业务源码不在本仓库：构建时由 DANMU_API_DIR 指过去（见 build-miniapp-node.js）。
import { handleRequest } from 'danmu-api/worker.js';

/** WebView 版用 'miniapp'：跳过 fs 本地缓存分支，行为与 Node 版保持一致直到另行验证。 */
const DEPLOY_PLATFORM = 'miniapp';

/** 客户 IP：全是本机回的，固定值就够，与 WebView 版一致。 */
const CLIENT_IP = '127.0.0.1';

let server = null;

/** 宿主会轮询这个路径判断业务口是否就绪，必须最快 200。 */
function checkResponse(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, service: 'danmu_api', runtime: 'node' }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (path === '/check') return checkResponse(res);

  try {
    const body = await readBody(req);
    const url = `http://127.0.0.1${req.url || '/'}`;
    // 真 Request：danmu_api 在 cloudflare / vercel 入口上拿到的就是它，
    // 比手搓替身更贴近上游假设（headers.get/has/forEach 全都在）。
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body.length ? body : undefined,
    });

    const response = await handleRequest(request, process.env, DEPLOY_PLATFORM, CLIENT_IP);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    const message = (e && e.stack) || String(e);
    console.error('[danmu-node] 处理失败 ' + path + ': ' + message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, errorMessage: String((e && e.message) || e) }));
  }
}

export function start() {
  const port = Number(process.env.DEV_HTTP_PORT);
  if (!port) throw new Error('DEV_HTTP_PORT 未设置，宿主没有分配端口');

  // catServerFactory 是宿主注入的：用它起服务宿主能立刻感知监听端口。
  server = globalThis.catServerFactory
    ? globalThis.catServerFactory(handle)
    : http.createServer(handle);

  server.listen(port, '127.0.0.1', () => {
    console.log('[danmu-node] listening on 127.0.0.1:' + port);
  });
}

export function stop() {
  if (!server) return undefined;
  return new Promise((resolve) => server.close(resolve));
}
