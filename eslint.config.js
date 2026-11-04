// @ts-check
import js from '@eslint/js'
import globals from 'globals'

/** flat 配置：host 纯 JS（无 TS，本项目无构建步骤）。 */
export default [
  {
    ignores: ['node_modules/', 'lib/', 'dist/', 'tests/fixtures/'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      // 测试里允许断言用的宽松模式
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    /**
     * 判定内核零 IO、零宿主依赖。
     * 理由：宿主半（patch-guard）与 CLI（patch-read）共用这一份判定——任何一侧能自己读盘，
     * 两套结论就会开始各说一套，而用户看到的只是“同一个按钮给了不同答案”。
     */
    files: ['src/patch-model.js'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['node:fs', 'node:path', 'node:os', 'node:child_process', 'node:sqlite', 'node:http'],
        patterns: ['fs', 'path', 'os', '@deepseek-ai/*', './patch-guard.js', './patch-read.js', './cli.js', './index.js'],
      }],
    },
  },
]
