/*!
 * miniapp-node/service/index.js —— 打进包里、由宿主 require 的入口。
 *
 * 宿主的管理器是这样加载它的（flutter_ant_video/assets/js/main.js）：
 *
 *   require(path.join(dir, 'index.js'))     // 目录 = manifest 里 node.entry 所在目录
 *   mod.start(config)                       // config 来自 node.config 指向的文件
 *
 * 所以这里有两个硬约束：必须是 CommonJS，必须导出 start / stop。
 * esbuild 的产物（danmu-service.cjs）是纯 CJS，本文件只是它外面的一层壳。
 *
 * 为什么要这层壳：danmu_api 的配置全走 process.env，而配置要在业务代码
 * **被加载之前**就位——不能指望 start() 里再补。壳里先把配置灌进去，
 * 再懒加载 bundle。
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'index.config.js');

function loadFileConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const loaded = require(CONFIG_PATH);
    return (loaded && loaded.default) || loaded || {};
  } catch (e) {
    console.error('[danmu-node] index.config.js 读取失败: ' + ((e && e.stack) || e));
    return {};
  }
}

/** 把配置写进 process.env：danmu_api 的 Envs 只认环境变量。空值当没设。 */
function applyEnv(config) {
  Object.keys(config || {}).forEach((key) => {
    const value = config[key];
    if (value === null || value === undefined || value === '') return;
    process.env[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });
}

let service = null;

module.exports = {
  start(config) {
    applyEnv(config || loadFileConfig());

    if (!service) service = require('./danmu-service.cjs');
    return service.start();
  },

  stop() {
    if (!service || typeof service.stop !== 'function') return undefined;
    return service.stop();
  },
};
