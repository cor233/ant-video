/*!
 * build-miniapp-node.js —— 把 danmu_api 打包成 flutter_ant_video 的 **Node 型**小程序。
 *
 * 与 WebView 版（上游仓库里的 build-miniapp.js）的区别只有运行时：
 *   WebView 版：包里是给浏览器跑的 bundle，fetch 换成 ant.request，fs/网络栈全靠 stub。
 *   Node 版（本脚本）：包里是给内嵌 node 跑的 bundle，node 内置模块全是真的，
 *                     宿主以 worker_threads 拉起 server/index.js 并分配端口。
 *
 * 业务源码不在这里——本目录只是 danmu_api 的宿主适配层。构建时用 DANMU_API_DIR
 * 指向 danmu_api 的 checkout（或 fork），找不到会自动往上找 ../danmu_api。
 *
 *   node build-miniapp-node.mjs                          # 输出 dist/miniapp-node/
 *   DANMU_API_DIR=~/src/danmu_api node build-miniapp-node.mjs
 *   node build-miniapp-node.mjs --minify                 # 压缩
 *
 * 用 .mjs 而不是 .js：本仓库根目录没有 package.json，`.js` 会被 node 当 CJS。
 * 依赖（esbuild 与业务包的 node-fetch 等）都从 DANMU_API_DIR 那边解析，本目录
 * 不需要 npm install。
 *
 * ⚠️ 当前是探针阶段的产物，用途是回答「danmu_api 能不能作为 node 型小程序跑起来」。
 *    stubs 里的四个模块和 WebView 版保持完全一致，是为了把变量收敛到「运行时」
 *    这一个上——它们能不能恢复（dan-any / bangumi-data / …）是下一步的事。
 */
import fs from 'fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

/**
 * 找 danmu_api 的 checkout。
 *
 * 环境变量优先；没有就从当前目录往上找兄弟目录，最多 6 层——够覆盖
 * `ant-video/mini-app/miniapps/<app>/` → `~/personal/danmu_api` 这种深度的相对关系。
 */
function resolveDanmuApiDir() {
  const looksRight = (dir) =>
    dir && fs.existsSync(path.join(dir, 'danmu_api', 'worker.js'));

  const fromEnv = process.env.DANMU_API_DIR;
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (looksRight(abs)) return abs;
    throw new Error(
      `DANMU_API_DIR 指向的目录里没有 danmu_api/worker.js：${abs}`
    );
  }

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'danmu_api');
    if (looksRight(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    '没找到 danmu_api 源码目录。把 DANMU_API_DIR 指到 danmu_api 的 checkout，例如：\n' +
      '  DANMU_API_DIR=~/personal/danmu_api node build-miniapp-node.js'
  );
}

const danmuApiDir = resolveDanmuApiDir();
const danmuApiSrc = path.join(danmuApiDir, 'danmu_api');

// esbuild 从 danmu_api 那边借——本仓库没有 node_modules，也不该为了打个包
// 在这儿再装一份（这个环境的 npm install 很慢）。业务依赖（node-fetch 等）
// 同样会在 bundle 时从 danmu_api 的 node_modules 解析。
const requireFromDanmuApi = createRequire(path.join(danmuApiDir, 'package.json'));
const esbuild = requireFromDanmuApi('esbuild');

function readVersion() {
  const source = fs.readFileSync(
    path.join(danmuApiSrc, 'configs/globals.js'),
    'utf8'
  );
  const match = /VERSION:\s*['"]([^'"]+)['"]/.exec(source);
  if (!match) throw new Error('没能从 globals.js 里读出 VERSION');
  return match[1];
}

const version = readVersion();
const minify = process.argv.includes('--minify');
// --bump [N]：适配层自己发版时给 versionCode 加 N（缺省 1）。versionCode 默认从上游
// danmu_api 版本推导，只改适配层（页面、权限、宿主契约）不改上游时，靠它让用户收到更新。
const bumpIndex = process.argv.indexOf('--bump');
const bump =
  bumpIndex >= 0 ? parseInt(process.argv[bumpIndex + 1], 10) || 1 : 0;
const outDir = 'dist/miniapp-node';
const bundleName = 'danmu-service.cjs';

/** 静态文件：[源文件, 包内路径]。本目录顶层就是适配层源码。 */
const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['index.html', 'index.html'],
  ['app.js', 'app.js'],
  ['service/index.js', 'server/index.js'],
  ['service/index.config.js', 'server/index.config.js'],
  // 标记 package 目录为 CommonJS。宿主的加载器是 require()，而 require 的语义
  // 受「最近的 package.json」影响：一旦包被解压进某个 "type": "module" 的仓库里
  // 试跑，index.js 会被当 ESM，报 ERR_REQUIRE_ESM。
  ['service/package.json', 'server/package.json']
];

/**
 * 换成空实现的模块——与 build-miniapp.js 里那份逐字一致。
 *
 * WebView 版换掉它们的理由是「WebView 里没有 fs」；Node 版其实有 fs 了，
 * 但仍然换掉，为的是先验证运行时本身。清单见 SOURCE.md。
 */
const stubs = {
  'ui/template.js': `export const HTML_TEMPLATE = ${JSON.stringify(
    '<!DOCTYPE html><meta charset="utf-8"><title>LogVar 弹幕服务</title>' +
      '<body style="font:14px -apple-system;padding:24px;background:#101216;color:#e8eaed">' +
      '<h3>请回到小程序页面操作</h3><p>小程序版没有内置 Web 配置页，' +
      '配置项在小程序首页编辑。</p>'
  )};`,

  'bangumi-data-util.js': `
    export async function ensureBangumiDataReady() { return false; }
    export function syncBangumiDataLifecycleOnConfigChange() {}
    export function getBackgroundDownload() { return null; }
    export function extendBangumiDownloadLifecycle() {}
    export async function initBangumiData() { return false; }
    export async function searchBangumiData() { return []; }
    export function dedupeBangumiSearchResults(results) { return results || []; }
    export function clearBangumiDataCache() {}
  `,

  'local-redis-util.js': `
    export async function getLocalRedisKey() { return null; }
    export async function setLocalRedisKey() {}
    export async function setLocalRedisKeyWithExpiry() {}
    export async function getLocalRedisCaches() {}
    export async function updateLocalRedisCaches() {}
    export async function judgeLocalRedisValid() { return false; }
    export async function closeLocalRedisConnection() {}
  `,

  'dan-any.js': `
    export const danAnyFormats = [];
    export function convertDanAny() { return null; }
  `
};

const miniappCompatPlugin = {
  name: 'miniapp-node-compat',
  setup(build) {
    // `danmu-api/xxx` → DANMU_API_DIR/danmu_api/xxx。
    build.onResolve({ filter: /^danmu-api\// }, (args) => ({
      path: path.join(danmuApiSrc, args.path.slice('danmu-api/'.length))
    }));

    // 项目内要换掉的模块。按整段相对路径尾部匹配而不是只看文件名，
    // 免得把依赖里同名的文件也一起换掉。
    const stubFilter = new RegExp(
      `(?:^|[\\\\/])(${Object.keys(stubs)
        .map((key) => key.replace(/\./g, '\\.').replace(/\//g, '[\\\\/]'))
        .join('|')})$`
    );
    build.onResolve({ filter: stubFilter }, (args) => {
      const normalized = args.path.replace(/\\/g, '/');
      const key = Object.keys(stubs).find((item) => normalized.endsWith(item));
      if (!key) return;
      return { path: key, namespace: 'miniapp-node-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'miniapp-node-stub' }, (args) => ({
      loader: 'js',
      contents: stubs[args.path]
    }));

    // redis：真 node 里当然是能装的，但探针阶段先跟 WebView 版保持一致。
    // danmu_api 只在配了 REDIS 相关变量时才会真的连，stub 掉不影响取弹幕。
    build.onResolve({ filter: /^redis$/ }, () => ({
      path: 'redis',
      namespace: 'miniapp-node-stub-redis'
    }));
    build.onLoad({ filter: /.*/, namespace: 'miniapp-node-stub-redis' }, () => ({
      loader: 'js',
      contents: `export function createClient() { throw new Error('redis not available in probe build'); }
export function createCluster() { throw new Error('redis not available in probe build'); }`
    }));
  }
};

(async () => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, 'server'), { recursive: true });

    const bundlePath = path.join(outDir, 'server', bundleName);

    await esbuild.build({
      entryPoints: ['service/entry.js'],
      bundle: true,
      minify,
      minifySyntax: true,
      sourcemap: false,
      // node 内置模块全部保持 external（真实存在），依赖走 node 分支。
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: bundlePath,
      plugins: [miniappCompatPlugin],
      external: ['node:*'],
      logLevel: 'info'
    });

    for (const [from, to] of staticFiles) {
      fs.copyFileSync(from, path.join(outDir, to));
    }

    // AGPL-3.0：分发目标代码就得带上许可与源码指引。
    fs.copyFileSync(path.join(danmuApiDir, 'LICENSE'), path.join(outDir, 'LICENSE'));
    fs.writeFileSync(path.join(outDir, 'SOURCE.md'), sourceNotice(version));

    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    manifest.versionCode = versionCodeOf(version) + bump;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const size = fs.statSync(bundlePath).size;
    console.log(
      `\nNode 型小程序包已生成: ${outDir}/ ` +
        `(bundle ${(size / 1024).toFixed(0)}KB, v${manifest.version})`
    );
    console.log('打 zip: cd dist/miniapp-node && zip -r ../logvar-danmu-node.zip .');
  } catch (error) {
    console.error('打包失败:', error);
    process.exitCode = 1;
  } finally {
    await esbuild.stop();
  }
})();

function sourceNotice(version) {
  let commit = '未知（构建时不在 git 仓库里）';
  try {
    // 必须是 danmu_api 那边的 commit：本脚本在外面的仓库里跑，
    // 不加 cwd 会记成 ant-video 的 HEAD，源码指引就指错地方了。
    commit = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      cwd: danmuApiDir
    }).trim();
  } catch {
    // 从 tarball 解出来构建的场景，没有 .git。
  }

  return `# 源码与许可

本小程序包内的 \`server/danmu-service.cjs\` 是 **LogVar 弹幕 API 服务**（danmu_api）的打包产物。

- 项目：https://github.com/huangxd-/danmu_api
- 许可：**AGPL-3.0**，全文见同目录的 \`LICENSE\`
- 版本：v${version}
- 构建自 commit：\`${commit}\`

## 取得对应源码

业务源码在上游仓库：

\`\`\`bash
git clone https://github.com/huangxd-/danmu_api
cd danmu_api && git checkout ${commit === '未知（构建时不在 git 仓库里）' ? `v${version}` : commit}
npm install
\`\`\`

宿主适配层（把 node 的请求接到 \`worker.js\` 的 \`handleRequest\` 上、按宿主的
启动契约导出 \`start/stop\`）在 ant-video 仓库的
\`mini-app/miniapps/logvar-danmu-node/\` 目录里——本包用的就是那一份。

## 从源码重建本包

\`\`\`bash
git clone https://github.com/ant-video/ant-video
cd ant-video/mini-app/miniapps/logvar-danmu-node
DANMU_API_DIR=<上一步的 danmu_api checkout> node build-miniapp-node.js
# 产物在 dist/miniapp-node/
\`\`\`

## 与远程部署版的差别

打包时以下模块被换成了空实现（与 WebView 版保持一致，探针阶段先不恢复）：

- \`ui/template.js\`（自带 Web 配置页）、\`bangumi-data-util.js\`（bangumi 数据集）、
  \`local-redis-util.js\`、\`dan-any.js\`（多格式弹幕转换），外加 \`redis\` 包。

node 内置模块（fs / http / https / url / path / stream）在 Node 版里都是**真的**，
不像 WebView 版那样被替换。
`;
}

/** `1.2.3` → 10203，保证版本号单调递增。 */
function versionCodeOf(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}
