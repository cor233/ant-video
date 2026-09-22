# LogVar 弹幕服务（Node 版）

把 [danmu_api](https://github.com/huangxd-/danmu_api) 作为 **Node 型小程序**跑在宿主内嵌
node 里（worker_threads），不需要另外部署 vercel / docker / NAS。装完把播放器的弹幕 API
填成 `miniapp://com.logvar.danmu.node` 即可，播放时宿主会自己在后台把它拉起来。

同一份服务的 **WebView 版**（`miniapp://com.logvar.danmu`）是另一条路线：在 WebView 里
polyfill 掉 node。两者可以共存，区别见文末。

## 这个目录是什么

danmu_api 的**宿主适配层**，业务源码不在这里。本目录只有三样东西：

- `service/entry.js` —— esbuild 入口。把 node 的 `IncomingMessage/ServerResponse` 翻译成
  `handleRequest` 认得的 `Request/Response`，并导出宿主要的 `start/stop`。
- `service/index.js` —— 打进包里的 `server/index.js`。宿主用 **CJS `require()`** 加载它
  （见宿主 `assets/js/main.js`），所以在业务代码被加载前先把 `index.config.js` 灌进
  `process.env`——danmu_api 的配置全是环境变量。
- `manifest.json` / `index.html` —— 小程序清单和占位页。node 型小程序也要求有 WebView
  入口，但服务本身不在页面里跑。

## 构建

```bash
node build-miniapp-node.mjs
# 或源码在别处：
DANMU_API_DIR=~/src/danmu_api node build-miniapp-node.mjs
```

`DANMU_API_DIR` 不传时会从当前目录往上找 `danmu_api/`（最多 6 层）。产物在
`dist/miniapp-node/`，打进 zip 由 `pack_miniapp.py` 负责（`dist/` 不入库）。

依赖从 danmu_api 那边借（esbuild、node-fetch、brotli…），**本目录不需要 `npm install`**。

## 发版

1. `node build-miniapp-node.mjs` —— 版本号自动跟随 danmu_api 的 `Globals.VERSION`
   （`versionCode` = major*10000 + minor*100 + patch）；
2. 预检 + 打包，产物丢到 `market/zip/logvar-danmu-node-v<versionCode>.zip`；
3. `market/market.json` 加条目，填上 size / md5（宿主会校验 md5）。

## 已知限制

- **没有配置界面。** SDK v4 不带 node 服务地址，页面拿不到 worker 的端口，
  `ant.request` 又禁回环、页面也写不了文件——所以「页面 ↔ node 服务」目前没有通道。
  配置只能写在包内 `service/index.config.js`，**改一项要重新打包**。要做配置页得先改宿主。
- **移动端没验过。** 桌面走 `assets/node/macos/node`（v18.20.8），移动端是 nodejs-mobile
  另一套二进制。内嵌 node 是 18.x，**没有 `require(esm)`**（要 20.19+），这也是入口必须
  打成 CJS 的原因。
- **探针阶段仍有 stub。** `ui/template.js`、`bangumi-data-util.js`、`local-redis-util.js`、
  `dan-any.js` 和 `redis` 包被换成了空实现，与 WebView 版保持一致。恢复它们（尤其是
  多格式弹幕转换 dan-any）正是 Node 版相对 WebView 版的主要收益，还没做。
- 内存：管理器 + worker 常驻约 230MB（桌面实测）。

## 与 WebView 版的差别

| | WebView 版 `com.logvar.danmu` | Node 版 `com.logvar.danmu.node` |
|---|---|---|
| 服务跑在哪 | WebView 里，`ant.serve` 接宿主转发 | 内嵌 node worker，自己监听端口 |
| `fetch` | 换成 `ant.request`（不受 CORS 限制） | 真 node-fetch v3 |
| node 内置模块 | 全是 stub | 全是真的 |
| 配置 | 小程序页面编辑，存 `ant.storage` | 写死在包内，改配置要重打包 |
| 权限 | `network`/`storage`/`ui`/`service` | 只要 `node` |
