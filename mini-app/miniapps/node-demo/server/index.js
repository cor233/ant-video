// 小程序 Node 服务示例：零 npm 依赖，演示 start(config) / stop() 契约。
//
// 契约要点（docs/miniapp/miniapp-developer-guide.md §4.11）：
// - 必须导出 start(config)；config 来自 index.config.js（或 manifest 的 node.config）
// - 监听端口用 process.env.DEV_HTTP_PORT，不要写死
// - 用宿主注入的 globalThis.catServerFactory 起服务，宿主能立刻感知监听端口与状态
// - /check 是宿主的就绪探测口，必须尽快 200
const http = require('http');

let server = null;

function buildHandler(config) {
  const greeting =
    (config && config.greeting) || 'hello from miniapp node worker';
  return (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (url.pathname === '/check') {
      res.end(JSON.stringify({ ok: true }));
    } else if (url.pathname === '/hello') {
      res.end(
        JSON.stringify({ message: greeting, pid: process.pid }),
      );
    } else if (url.pathname === '/api/time') {
      res.end(
        JSON.stringify({
          now: new Date().toISOString(),
          node: process.version,
        }),
      );
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
    }
  };
}

module.exports = {
  start: (config) => {
    const handler = buildHandler(config);
    server = globalThis.catServerFactory
      ? globalThis.catServerFactory(handler)
      : http.createServer(handler);
    server.listen(Number(process.env.DEV_HTTP_PORT), '127.0.0.1');
  },
  stop: () => {
    if (server) server.close();
  },
};
