# Node 服务示例小程序

演示小程序携带 Node.js 后端（宿主以 worker_threads worker 运行，见
`docs/miniapp/miniapp-developer-guide.md` §4.11）。零 npm 依赖，方便快速验证。

## 安装

小程序中心 → 右上角 `+` → **导入文件夹** → 选择本目录
（`mini-app/miniapps/node-demo`，选内层包含 `manifest.json` 的那一层也行）。

## 验证

1. **手动启停**：已安装列表 → 长按/菜单 → 「属性与权限」→ 「Node 服务」区块
   → 点「启动」，状态变为 `运行中 · 端口 NNNN`；同局域网或本机访问
   `http://127.0.0.1:NNNN/hello` 应返回 `index.config.js` 里配置的问候语。
2. **按需自启**：点「停止」后，在任何认 `miniapp://` 地址的设置里填
   `miniapp://com.leospring.node_demo/api/time`（如弹幕源），宿主解析地址时会
   自动把 worker 拉起来。
3. **视频切换不打断**：服务运行中切换视频配置（.md5 Node 源），回到详情页
   状态应仍是「运行中」。
4. **升级/卸载**：改 `manifest.json` 的 `versionCode` 重装，或直接卸载——
   worker 都会先被停掉。

## 目录结构

```
manifest.json            node 块声明 + node 权限
index.html               占位前端页（node 型小程序也要求有 entry）
server/index.js          服务端：start(config)/stop()，监听 DEV_HTTP_PORT
server/index.config.js   传给 start 的配置
```
