const path = require('path');

let runtime = null;
let started = false;

function applyConfig(config) {
  const rootDir = path.join(__dirname, 'source');
  process.env.DRPY_MINIAPP = '1';
  process.env.DRPY_NO_AUTOSTART = '1';
  process.env.ROOT = rootDir;
  process.env.HOST = '127.0.0.1';
  Object.entries(config || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  });
}

async function loadRuntime() {
  if (!runtime) runtime = await import('./source/index.js');
  return runtime;
}

module.exports = {
  async start(config) {
    if (started) return;
    applyConfig(config);
    const service = await loadRuntime();
    await service.start();
    started = true;
  },

  async stop() {
    if (!runtime || !started) return;
    try {
      await runtime.stop();
    } finally {
      started = false;
    }
  },
};
