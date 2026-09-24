/**
 * 客户端图片发送前预处理决策纯函数测试（TDD）。
 * 口径：png/jpeg/webp 原样发送（≤4MB）；>4MB → 重编码（受限尺寸 2048 + JPEG 0.85）；
 * gif → 重编码（静态首帧）；不支持格式/空文件/非法尺寸 → 剔除；全部剔除 → 纯文本降级提示。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREPROCESS_MAX_BYTES,
  REENCODE_MAX_DIMENSION,
  REENCODE_QUALITY,
  planImage,
  buildPreprocessNote,
} from '../src/lib/images.ts'

test('阈值常量：重编码上限 4MB、受限尺寸 2048、JPEG 质量 0.85', () => {
  assert.equal(PREPROCESS_MAX_BYTES, 4 * 1024 * 1024)
  assert.equal(REENCODE_MAX_DIMENSION, 2048)
  assert.equal(REENCODE_QUALITY, 0.85)
})

test('planImage：小体积 png/jpeg/webp → keep（原样发送）', () => {
  assert.deepEqual(planImage({ type: 'image/png', size: 1024 }), { ok: true, action: 'keep', mediaType: 'image/png' })
  assert.deepEqual(planImage({ type: 'image/jpeg', size: PREPROCESS_MAX_BYTES }), { ok: true, action: 'keep', mediaType: 'image/jpeg' }, '恰好等于阈值 → keep')
  assert.deepEqual(planImage({ type: 'image/webp', size: 0.5 }), { ok: true, action: 'keep', mediaType: 'image/webp' })
})

test('planImage：>4MB png/jpeg/webp → reencode（受限尺寸/JPEG）', () => {
  assert.deepEqual(planImage({ type: 'image/png', size: PREPROCESS_MAX_BYTES + 1 }), { ok: true, action: 'reencode', mediaType: 'image/png' })
  assert.deepEqual(planImage({ type: 'image/jpeg', size: 100 * 1024 * 1024 }), { ok: true, action: 'reencode', mediaType: 'image/jpeg' })
})

test('planImage：gif 任意体积 → reencode（模型通道按静态首帧/JPEG 兼容）', () => {
  assert.deepEqual(planImage({ type: 'image/gif', size: 100 }), { ok: true, action: 'reencode', mediaType: 'image/gif' })
  assert.deepEqual(planImage({ type: 'image/gif', size: 100 * 1024 * 1024 }), { ok: true, action: 'reencode', mediaType: 'image/gif' })
})

test('planImage：不支持格式（bmp/svg/空类型/任意非枚举）→ 剔除', () => {
  assert.deepEqual(planImage({ type: 'image/bmp', size: 10 }), { ok: false, reason: 'unsupported-image-type' })
  assert.deepEqual(planImage({ type: 'image/svg+xml', size: 10 }), { ok: false, reason: 'unsupported-image-type' })
  assert.deepEqual(planImage({ type: '', size: 10 }), { ok: false, reason: 'unsupported-image-type' })
  assert.deepEqual(planImage({ type: 'text/plain', size: 10 }), { ok: false, reason: 'unsupported-image-type' })
})

test('planImage：空文件/零/负/NaN 尺寸 → 剔除（不发送空图）', () => {
  assert.deepEqual(planImage({ type: 'image/png', size: 0 }), { ok: false, reason: 'empty-image' })
  assert.deepEqual(planImage({ type: 'image/png', size: -1 }), { ok: false, reason: 'empty-image' })
  assert.deepEqual(planImage({ type: 'image/png', size: Number.NaN }), { ok: false, reason: 'empty-image' })
})

test('buildPreprocessNote：全部失败 → 降级提示；部分失败 → 部分提示；全部成功 → null', () => {
  assert.equal(buildPreprocessNote(2, 0), '图片处理失败，已按纯文本优化')
  assert.equal(buildPreprocessNote(3, 1), '3 张图片中 2 张处理失败，仅发送 1 张')
  assert.equal(buildPreprocessNote(0, 0), null)
  assert.equal(buildPreprocessNote(2, 2), null)
})
