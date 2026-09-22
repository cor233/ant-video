# 咪咕直播 小程序

本目录将 `/Users/leospring/Downloads/migu_video-main` 适配为 flutter_ant_video 小程序，
同时提供两种用法：**页面内精美直播 UI（点击即播）** 与 **Node 服务型取流接口（M3U/TXT/EPG）**。

## 两种用法

### A. 打开小程序直接看（页面 UI）

打开小程序即进入直播频道界面：顶部分类切换（央视 / 卫视 / …），下方频道卡片网格（台标 + 名称），
点击任一频道即调起宿主播放器全屏播放。支持 TV 遥控方向键 + 确定键操作，自动记住上次看的分类。

- 取流走**游客高清模式**（约 720p），无需登录、无封号风险。
- 全程在页面里用 `ant.request` 直连咪咕公开接口取流，再交给 `ant.player.open` 播放，
  **不经过本包的 Node 服务**——因为宿主不允许小程序页面访问自己的 `miniapp://` 服务。
- 页面取流逻辑独立实现于 `migu.js`（游客链路：`getAndroidURL720p` + `getddCalcuURL720p`，纯 JS MD5）。

### B. 作为 IPTV 直播源（Node 服务）

1. 在小程序中心导入本目录，或导入打包后的 zip。
2. 在小程序详情页启动 Node 服务；使用 `miniapp://com.leospring.migu_video.node/m3u` 获取 M3U。
3. TXT 与 EPG 地址分别为 `/txt`、`/playback.xml`，频道地址由列表自动生成。
4. 如需局域网使用，在宿主的小程序详情页开启“局域网共享”。不要手工填写 worker 的临时端口。

> Node 服务（`server/`）与页面 UI 各自独立，互不影响。服务侧支持账号/更高画质，页面侧固定游客高清。

## 配置

编辑 `server/index.config.js` 后重新打包安装。配置项与原项目环境变量一致，但不需要设置 `mport` 和 `mhost`：端口由宿主分配，列表地址根据请求 Host 自动生成。

默认不填账号和 Token。原项目说明登录存在封号风险，使用账号模式前请自行评估。

## 适配点

- CommonJS `start(config)` / `stop()` 宿主生命周期；
- `DEV_HTTP_PORT` 动态端口与 `catServerFactory`；
- 无鉴权的 `/check` 就绪探针；
- 业务数据路径从宿主 cwd 改为包内 `server/source`；
- 保留原项目的 M3U、TXT、EPG、频道 302 取流和定时更新逻辑。

业务源码来源：`develop202/migu_video`。请遵守原项目 README 中的学习用途、版权及地域限制说明。
