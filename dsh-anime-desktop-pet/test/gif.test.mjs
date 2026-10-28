/**
 * GIF 资源验收：不依赖图像库，直接解析 GIF/PNG 二进制。
 * 覆盖：16 帧、统一画布、透明索引、无限循环、文件可读（GD 描述符完整、以 trailer 结束）。
 * 生成命令见 scripts/build-gif.py；本测试先于生成（红），生成后转绿。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const GIF = join(root, 'assets', 'blue-fat-fish-working.gif')
const GRID = join(root, 'assets', 'raw', 'grid.png')
const FRAMES_DIR = join(root, 'assets', 'raw', 'frames')
const FIXED_GIF = join(root, 'assets', 'animated', 'blue-fat-fish-eating.gif')
const FIXED_GRID = join(root, 'assets', 'raw', 'fixed-character-grid.png')
const FIXED_FRAMES_DIR = join(root, 'assets', 'raw', 'fixed-frames')
const TIRED_GIF = join(root, 'assets', 'animated', 'blue-fat-fish-tired.gif')
const TIRED_GRID = join(root, 'assets', 'raw', 'tired-grid.png')
const TIRED_FRAMES_DIR = join(root, 'assets', 'raw', 'tired-frames')
const BANNER = join(root, 'assets', 'banner', 'blue-fat-fish-live-banner.gif')
const BANNER_ELEMENTS = join(root, 'assets', 'banner', 'elements')

/** 读 PNG IHDR 宽高与颜色类型（6=RGBA）。 */
function pngInfo(path) {
  const b = readFileSync(path)
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} is not a PNG`)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] }
}

/** 跳过 GIF 子块序列，返回下一个块起点。 */
function skipSubBlocks(b, i) {
  while (i < b.length) {
    const n = b[i]
    i += 1
    if (n === 0) return i
    i += n
  }
  throw new Error('unterminated GIF sub-block')
}

/** 解析 GIF：帧数、逻辑画布、每帧透明色/延时、NETSCAPE 循环次数。 */
function gifInfo(path) {
  const b = readFileSync(path)
  assert.equal(b.subarray(0, 6).toString('latin1'), 'GIF89a', 'GIF header')
  const width = b.readUInt16LE(6)
  const height = b.readUInt16LE(8)
  const packed = b[10]
  let i = 13
  if (packed & 0x80) i += 3 * (2 ** ((packed & 7) + 1)) // 全局色表
  let frames = 0
  let loop
  const transparent = []
  const delays = []
  let pendingTransparency
  let pendingDelay
  while (i < b.length) {
    const lead = b[i]
    if (lead === 0x3b) break // trailer
    if (lead === 0x21) {
      const label = b[i + 1]
      if (label === 0xf9) {
        const flags = b[i + 3]
        pendingDelay = b.readUInt16LE(i + 4) * 10 // GIF 延时单位 = 1/100s
        pendingTransparency = (flags & 1) === 1 ? b[i + 6] : undefined
      } else if (label === 0xff) {
        const size = b[i + 2]
        const app = b.subarray(i + 3, i + 3 + size).toString('latin1')
        if (app.startsWith('NETSCAPE2.0')) {
          const sub = i + 3 + size // sub-block size byte (0x03), then 0x01, then LE uint16
          assert.equal(b[sub], 3, 'NETSCAPE sub-block size')
          assert.equal(b[sub + 1], 1, 'NETSCAPE sub-block id')
          loop = b.readUInt16LE(sub + 2)
        }
      }
      i += 2
      i = skipSubBlocks(b, i)
      continue
    }
    if (lead === 0x2c) {
      frames += 1
      transparent.push(pendingTransparency)
      delays.push(pendingDelay)
      pendingTransparency = undefined
      pendingDelay = undefined
      const imgPacked = b[i + 9]
      i += 10
      if (imgPacked & 0x80) i += 3 * (2 ** ((imgPacked & 7) + 1)) // 局部色表
      i += 1 // LZW 最小码长
      i = skipSubBlocks(b, i)
      continue
    }
    throw new Error(`unknown GIF block 0x${lead.toString(16)} at ${i}`)
  }
  return { width, height, frames, loop, transparent, delays }
}

test('GIF 资源存在且为 16 帧、透明索引、无限循环', () => {
  assert.ok(existsSync(GIF), `missing ${GIF} — run: python scripts/build-gif.py`)
  const gif = gifInfo(GIF)
  assert.equal(gif.frames, 16, 'must carry exactly the 16 storyboard frames')
  assert.equal(gif.width, gif.height, 'unified canvas must be square')
  assert.ok(gif.width >= 128 && gif.width <= 512, `canvas size ${gif.width} out of range`)
  assert.equal(gif.loop, 0, 'NETSCAPE loop count 0 means loop forever')
  assert.equal(gif.transparent.length, 16)
  for (const [index, indexValue] of gif.transparent.entries()) {
    assert.notEqual(indexValue, undefined, `frame ${index + 1} must declare a transparent palette index`)
  }
  assert.ok(statSync(GIF).size < 6 * 1024 * 1024, `GIF too large: ${statSync(GIF).size} bytes`)
})

test('GIF 帧延时统一且节奏已放慢（每帧 200–500ms）', () => {
  assert.ok(existsSync(GIF), `missing ${GIF} — run: python scripts/build-gif.py`)
  const gif = gifInfo(GIF)
  assert.equal(gif.delays.length, 16, 'every frame must carry a Graphic Control Extension delay')
  const unique = [...new Set(gif.delays)]
  assert.equal(unique.length, 1, `all frames must share one delay, got ${unique.join('/')}ms`)
  assert.ok(unique[0] >= 200 && unique[0] <= 500, `per-frame delay ${unique[0]}ms is outside the slow-tempo range`)
})

test('原始素材保留：16 格网格与 16 张 raw 帧', () => {
  assert.ok(existsSync(GRID), `missing original grid ${GRID}`)
  assert.deepEqual(pngInfo(GRID), { width: 1254, height: 1254, colorType: 6 }, 'original grid must stay untouched (1254² RGBA)')
  const frames = readdirSync(FRAMES_DIR).filter((name) => /^frame-\d{2}\.png$/.test(name)).sort()
  assert.equal(frames.length, 16, `expected 16 raw frames in ${FRAMES_DIR}`)
  frames.forEach((name) => {
    const info = pngInfo(join(FRAMES_DIR, name))
    assert.equal(info.colorType, 6, `${name} must keep alpha channel (RGBA)`)
    assert.ok(info.width > 64 && info.height > 64, `${name} too small: ${info.width}x${info.height}`)
  })
})

test('固定形象 GIF：25 帧、透明、无限循环、统一慢节奏', () => {
  assert.ok(existsSync(FIXED_GIF), `missing ${FIXED_GIF} — run: python scripts/build-fixed-gif.py`)
  const gif = gifInfo(FIXED_GIF)
  assert.equal(gif.frames, 25, 'fixed character must use exactly the 25 provided panels')
  assert.equal(gif.width, gif.height, 'fixed GIF canvas must be square')
  assert.ok(gif.width >= 128 && gif.width <= 512, `canvas size ${gif.width} out of range`)
  assert.equal(gif.loop, 0, 'fixed GIF must loop forever')
  assert.equal(gif.transparent.length, 25)
  for (const [index, value] of gif.transparent.entries()) {
    assert.notEqual(value, undefined, `fixed frame ${index + 1} must declare a transparent palette index`)
  }
  const delays = [...new Set(gif.delays)]
  assert.equal(delays.length, 1, `fixed GIF frames must share one delay, got ${delays.join('/')}ms`)
  assert.ok(delays[0] >= 250 && delays[0] <= 500, `fixed GIF delay ${delays[0]}ms is outside the slow range`)
  assert.ok(statSync(FIXED_GIF).size < 8 * 1024 * 1024, `fixed GIF too large: ${statSync(FIXED_GIF).size} bytes`)
})

test('固定形象原始素材保留：25 格网格与 25 张 raw 帧', () => {
  assert.ok(existsSync(FIXED_GRID), `missing fixed source grid ${FIXED_GRID}`)
  assert.deepEqual(pngInfo(FIXED_GRID), { width: 1254, height: 1254, colorType: 6 }, 'fixed grid must stay untouched (1254² RGBA)')
  const frames = readdirSync(FIXED_FRAMES_DIR).filter((name) => /^frame-\d{2}\.png$/.test(name)).sort()
  assert.equal(frames.length, 25, `expected 25 raw frames in ${FIXED_FRAMES_DIR}`)
  frames.forEach((name) => {
    const info = pngInfo(join(FIXED_FRAMES_DIR, name))
    assert.equal(info.colorType, 6, `${name} must keep alpha channel (RGBA)`)
    assert.ok(info.width > 64 && info.height > 64, `${name} too small: ${info.width}x${info.height}`)
  })
})

test('上下文很累动画 GIF：16 帧、透明、无限循环、统一慢节奏', () => {
  assert.ok(existsSync(TIRED_GIF), `missing ${TIRED_GIF} — run: python scripts/build-tired-gif.py`)
  const gif = gifInfo(TIRED_GIF)
  assert.equal(gif.frames, 16, 'tired animation must use exactly the 16 provided panels')
  assert.equal(gif.width, gif.height, 'tired GIF canvas must be square')
  assert.ok(gif.width >= 128 && gif.width <= 512, `canvas size ${gif.width} out of range`)
  assert.equal(gif.loop, 0, 'tired GIF must loop forever')
  assert.equal(gif.transparent.length, 16)
  for (const [index, value] of gif.transparent.entries()) {
    assert.notEqual(value, undefined, `tired frame ${index + 1} must declare a transparent palette index`)
  }
  const delays = [...new Set(gif.delays)]
  assert.equal(delays.length, 1, `tired GIF frames must share one delay, got ${delays.join('/')}ms`)
  assert.ok(delays[0] >= 250 && delays[0] <= 500, `tired GIF delay ${delays[0]}ms is outside the slow range`)
  assert.ok(statSync(TIRED_GIF).size < 8 * 1024 * 1024, `tired GIF too large: ${statSync(TIRED_GIF).size} bytes`)
})

test('上下文很累原始素材保留：4×4 网格与 16 张 raw 帧', () => {
  assert.ok(existsSync(TIRED_GRID), `missing tired source grid ${TIRED_GRID}`)
  assert.deepEqual(pngInfo(TIRED_GRID), { width: 1295, height: 1214, colorType: 6 }, 'tired grid must stay untouched (1295×1214 RGBA)')
  const frames = readdirSync(TIRED_FRAMES_DIR).filter((name) => /^frame-\d{2}\.png$/.test(name)).sort()
  assert.equal(frames.length, 16, `expected 16 raw frames in ${TIRED_FRAMES_DIR}`)
  frames.forEach((name) => {
    const info = pngInfo(join(TIRED_FRAMES_DIR, name))
    assert.equal(info.colorType, 6, `${name} must keep alpha channel (RGBA)`)
    assert.ok(info.width > 128 && info.height > 128, `${name} too small: ${info.width}x${info.height}`)
  })
})

test('桌面横幅 GIF：24 帧透明循环、80ms，元素切图清单完整', () => {
  assert.ok(existsSync(BANNER), `missing ${BANNER} — run: python scripts/build-banner-animation.py`)
  const gif = gifInfo(BANNER)
  assert.equal(gif.frames, 24, 'banner must carry the composed animation frames')
  assert.deepEqual([gif.width, gif.height], [1086, 362], 'banner keeps the 3:1 aspect at half source resolution')
  assert.equal(gif.loop, 0, 'banner GIF must loop forever')
  assert.equal(gif.transparent.length, 24)
  for (const [index, value] of gif.transparent.entries()) {
    assert.notEqual(value, undefined, `banner frame ${index + 1} must declare transparency`)
  }
  const delays = [...new Set(gif.delays)]
  assert.deepEqual(delays, [80], 'banner uses an 80ms frame delay')
  assert.ok(statSync(BANNER).size < 6 * 1024 * 1024, `banner GIF too large: ${statSync(BANNER).size} bytes`)

  const manifestPath = join(BANNER_ELEMENTS, 'manifest.json')
  assert.ok(existsSync(manifestPath), 'missing extracted element manifest')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.ok(manifest.length >= 120, `expected all meaningful elements, got ${manifest.length}`)
  const kinds = new Set(manifest.map((entry) => entry.kind))
  assert.deepEqual(kinds, new Set(['balloon', 'ribbon', 'star']), 'balloons, ribbons and stars must all be cut out')
  for (const entry of manifest) {
    assert.ok(existsSync(join(root, entry.file)), `missing extracted element ${entry.file}`)
    assert.ok(entry.area > 0 && entry.bbox.length === 4, `bad manifest entry ${entry.file}`)
  }
})
