# drpy-node Node 小程序

本目录将 `/Users/leospring/Downloads/drpy-node-main` 适配为 flutter_ant_video 的 Node 服务型小程序。

## 安装与使用

1. 在小程序中心导入本目录，或导入 `drpy-node-v1.zip`。
2. 在详情页启动 Node 服务；宿主会动态分配端口并通过 `/check` 探针确认就绪。
3. 消费方使用 `miniapp://com.leospring.drpy_node/...`，不需要填写 worker 的实际端口。

主要对外接口：

- 通用影视配置：`miniapp://com.leospring.drpy_node/config/1?healthy=1`
- 猫源配置：`miniapp://com.leospring.drpy_node/config/index.js.md5`

其他常用路径：`/health`、`/api/<模块名>`、`/proxy/<模块名>/...`、`/parse/<解析器>`、`/js/`、`/json/`。

## 配置

编辑 `server/index.config.js` 后重新打包。配置项对应原项目环境变量，至少建议设置 `API_PWD` 或认证账号密码。默认配置不启用文件日志。

## 适配范围

- 保留原项目 Fastify 路由、规则引擎、源文件、JSON 配置和依赖；
- `server/index.js` 提供宿主要求的 CommonJS `start(config)` / `stop()`；
- 使用 `DEV_HTTP_PORT` 动态端口；
- 增加无鉴权 `/check` 和 `/miniapp/status`；
- 小程序模式关闭 Python 守护进程、WebSocket 独立端口及外部插件子进程。

原项目采用 MIT License；请同时遵守其 README 中关于第三方源、版权和合法使用的说明。
