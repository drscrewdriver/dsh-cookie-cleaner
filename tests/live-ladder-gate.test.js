// 借句柄快照阶梯的启用判据：宿主进程内才开，独立 node（测试/脚本）关掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldUseLiveLadder } from '../src/index.js'

test('Electron 主进程启用阶梯', () => {
  assert.equal(shouldUseLiveLadder({}, { type: 'browser', versions: {} }), true)
})

test('以 Electron 为 node 的宿主子进程启用阶梯', () => {
  assert.equal(shouldUseLiveLadder({}, { versions: { electron: '33.0.0', node: '22.0.0' } }), true)
})

test('独立 node（无 electron、无 type）关掉阶梯——这是单测/脚本不扫句柄表的原因', () => {
  assert.equal(shouldUseLiveLadder({}, { versions: { node: '22.0.0' } }), false)
})

test('显式开关覆盖判据', () => {
  assert.equal(shouldUseLiveLadder({ DSH_COOKIE_LIVE_LADDER: '1' }, { versions: { node: '22.0.0' } }), true)
  assert.equal(shouldUseLiveLadder({ DSH_COOKIE_LIVE_LADDER: 'on' }, { versions: { node: '22.0.0' } }), true)
  assert.equal(shouldUseLiveLadder({ DSH_COOKIE_LIVE_LADDER: '0' }, { type: 'browser' }), false)
  assert.equal(shouldUseLiveLadder({ DSH_COOKIE_LIVE_LADDER: 'off' }, { type: 'browser' }), false)
})

test('默认读真实 process/env（宿主里为真值形状，不抛）', () => {
  assert.equal(typeof shouldUseLiveLadder(), 'boolean')
})