/**
 * dsh-cookie-cleaner — client bundle 构建（tsdown）。
 *
 * 语义对齐宿主 `packages/client/tsdown.client.ts`：`src/client/index.ts → lib/client.js`
 * （CJS / browser），带 `window.__ModuleLoader__.load` 的闭包工厂 banner/footer。
 *
 * **PLUGIN_ID 必须是 npm 包名**：宿主按 `graphRow(packageName, …)` 建图
 * （`client/modules/src/index.ts:1040`），注册的 id 与图不一致时 client 半从不加载
 * ——「包已装但 UI 全无」的经典成因。
 *
 * react 与 `@deepseek-ai/dsh-client-*` 是平台外部模块，由宿主的共享模块表提供，
 * 打进 bundle 会得到第二份 React 实例（hooks 全废）。
 */
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = 'dsh-cookie-cleaner'

/** 宿主共享给浏览器 bundle 的平台模块（external，不打包）。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-renderer',
]

const entry = fileURLToPath(new URL('./src/client/index.ts', import.meta.url))

export default {
  name: `${PLUGIN_ID}/client`,
  entry: { client: entry },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  dts: false,
  sourcemap: true,
  clean: false,
  external: PLATFORM_MODULES,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
