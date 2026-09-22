/*!
 * index.config.js —— Node 服务的启动配置。
 *
 * 宿主会把这个文件的导出值传给 server/index.js 的 start(config)，
 * 壳再把每一项写进 process.env —— danmu_api 的配置全是环境变量。
 *
 * 键名与 danmu_api 的环境变量一致（TOKEN / SOURCE_ORDER / LOG_LEVEL …），
 * 完整清单见上游 README。空值等于没设，走 danmu_api 自己的默认值。
 *
 * ⚠️ 探针版没有配置界面：这个文件在包里，改了要重新打包。
 */
module.exports = {
  // 日志级别：warn（默认）/ info。排查问题时调成 info。
  LOG_LEVEL: 'warn',
};
