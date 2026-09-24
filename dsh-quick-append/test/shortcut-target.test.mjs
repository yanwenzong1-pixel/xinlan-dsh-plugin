/**
 * 快捷键（Shift+Alt+F）输入面判定回归测试。
 *
 * 背景（2026-09-11 线上故障）：升级 DSH 0.1.5-rc.1 后快捷键完全无响应。
 * 根因是 composer 由 <textarea> 改为 Lexical contenteditable div
 * （ComposerContentEditable.tsx:42-46，带 data-composer-input），
 * 而旧判定 `el instanceof HTMLTextAreaElement` 恒为 false。
 *
 * 本测试锁死两种输入面都必须被认作「在输入面」，防同类回归再次发生。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isComposerInputPoint,
  COMPOSER_INPUT_ATTR,
  COMPOSER_LEGACY_TAG,
} from '../src/lib/interaction.ts'

/** 极简元素桩：只实现判定所需的最小形状，不依赖 DOM 实现细节。 */
function el(tagName, attrs = {}) {
  return {
    tagName,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
  }
}

// —— 新输入面：0.1.5 的 contenteditable div（本次故障面）——

test('新输入面：带 data-composer-input 的 div → 判定为输入面', () => {
  assert.equal(isComposerInputPoint(el('DIV', { [COMPOSER_INPUT_ATTR]: '' })), true)
})

test('新输入面：属性名拼写必须与官方组件一致（data-composer-input）', () => {
  // 上游改名会让快捷键静默失效，这里显式锁死契约字面量。
  assert.equal(COMPOSER_INPUT_ATTR, 'data-composer-input')
})

test('新输入面：标签名大小写不敏感（DIV / div 均可）', () => {
  assert.equal(isComposerInputPoint(el('div', { [COMPOSER_INPUT_ATTR]: '' })), true)
})

// —— 旧输入面：0.1.5 之前的 textarea（回退路径必须保留）——

test('旧输入面：无新属性的 textarea → 仍判定为输入面（回退不回归）', () => {
  assert.equal(isComposerInputPoint(el('TEXTAREA')), true)
})

test('旧输入面：标签名小写 textarea → 仍判定为输入面', () => {
  assert.equal(isComposerInputPoint(el('textarea')), true)
})

test('旧输入面：常量字面量锁死为 TEXTAREA', () => {
  assert.equal(COMPOSER_LEGACY_TAG, 'TEXTAREA')
})

// —— 非输入面：快捷键必须在这些场景下保持零侵入 ——

test('非输入面：普通 div（未带钩子）→ 判否', () => {
  assert.equal(isComposerInputPoint(el('DIV')), false)
})

test('非输入面：输入框之外的可编辑/按钮元素 → 判否', () => {
  for (const tag of ['BUTTON', 'INPUT', 'BODY', 'SPAN', 'P']) {
    assert.equal(isComposerInputPoint(el(tag)), false, `${tag} 不应被判为输入面`)
  }
})

test('非输入面：空值 → 判否，且不抛异常', () => {
  assert.equal(isComposerInputPoint(null), false)
  assert.equal(isComposerInputPoint(undefined), false)
})

test('畸形输入：缺 hasAttribute / 缺 tagName → 判否而非抛异常', () => {
  assert.equal(isComposerInputPoint({}), false)
  assert.equal(isComposerInputPoint({ tagName: 'TEXTAREA' }), false)
  assert.equal(isComposerInputPoint({ hasAttribute: () => true }), false)
})

// —— 真实 DOM 契约：属性名与官方组件的挂载点一致 ——

test('契约：data-composer-input 是官方 ComposerContentEditable 挂载的属性名', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(
    'C:/Users/<user>/Documents/Deepseek/_upgrade/dsh-v0.1.5-rc.1/src/deepseek-harness-dsh-v0.1.5-rc.1'
    + '/packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx',
    'utf8',
  )
  assert.match(
    source,
    new RegExp(COMPOSER_INPUT_ATTR),
    '官方组件已不再挂载该属性，快捷键判定需同步更新',
  )
  assert.match(source, /contentEditable/, '官方输入面应为 contenteditable')
})
