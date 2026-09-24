/**
 * 「追加文案」按工作区隔离 —— **客户端接线门禁**（TDD 先红后绿）。
 *
 * 为什么需要这一层：tsconfig.json 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**，
 * 叶子单测全绿也证明不了"客户端真的用了叶子、真的按工作区绑定、真的把失败显示出来"。
 * 本文件断言源码里的**接线**（谁读、谁写、写的时候用哪个键、失败怎么反馈、监听有没有收回来）。
 *
 * 注释会引用被删掉的旧标识符（说明改了什么），所以负面断言一律**先剥注释**再扫。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
/** 剥掉块注释与整行行注释后的代码（负面断言用）。 */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

test('W1 客户端必须用叶子（存储结构/键名/判定只有一处来源）', () => {
  assert.match(raw, /from '\.\.\/lib\/preset-store\.js'/, '客户端必须从叶子导入（不得自己拼 JSON、自己写键名）')
  for (const fn of ['presetOf', 'workspaceKeyOf', 'parsePresetStore', 'serializePresetStore', 'withPreset', 'migrateLegacyPreset', 'createCoalescingWriter', 'presetWriteFailedText']) {
    assert.ok(raw.includes(fn), `客户端未使用叶子的 ${fn}`)
  }
})

test('W2 键名只来自叶子：客户端代码里不得再出现裸键名（含旧键）', () => {
  assert.ok(raw.includes('PRESET_STORE_KEY'), '必须引用叶子的新键常量')
  assert.ok(raw.includes('LEGACY_PRESET_KEY'), '必须引用叶子的旧键常量（迁移用）')
  for (const literal of ["'dsh-quick-append.presets'", "'dsh-quick-append.text'"]) {
    assert.ok(!code.includes(literal), `代码里出现裸键名 ${literal} —— 必须走叶子常量，避免两处漂移`)
  }
})

test('W3 旧的单键读写必须彻底移除（不留死代码）', () => {
  assert.ok(!code.includes('STORAGE_KEY'), '旧常量 STORAGE_KEY 仍在 —— 单键读写应已整体替换')
  assert.ok(!/localStorage\.getItem\(STORAGE_KEY/.test(code), '旧的整段读取仍在')
  assert.ok(!/localStorage\.setItem\(STORAGE_KEY/.test(code), '旧的整段写入仍在')
})

test('W4 读取前必须解析并绑定当前工作区标识（用 ID，不是展示名）', () => {
  assert.match(raw, /workspaceKeyOf\(/, '必须用 workspaceKeyOf 解析当前工作区键')
  assert.match(raw, /sessionIds/, '解析必须基于工作区的 sessionIds（按 ID 归属），不得按 title/path 匹配')
  assert.ok(!/\.title\s*===/.test(code), '不得用展示名（title）当配置键')
  assert.match(raw, /sessionId\??:\s*string/, '插槽标准 props 里的 sessionId 必须被声明使用')
})

test('W5 写入必须绑定「编辑开始时」的工作区键（切换工作区不串写）', () => {
  assert.match(raw, /const editKeyRef = useRef/, '必须用 ref 保存本次编辑所属的工作区键')
  assert.match(raw, /editKeyRef\.current = presetWorkspaceKey/, '打开编辑弹窗时必须把当前工作区键捕获进 ref')
  assert.match(raw, /submit\(editKeyRef\.current/, '保存时必须用捕获的键提交（不能用"当前"键，否则切工作区就串写）')
})

test('W6 写入走合并写入器（防抖/合并，降低 IO 频率）', () => {
  assert.match(raw, /createCoalescingWriter\(\{[\s\S]{0,400}?delayMs:/, '必须用注入 delayMs 的合并写入器')
  assert.match(raw, /writerRef/, '写入器必须在组件内持有（单实例）')
})

test('W7 未落盘的写入必须被 flush：卸载 / 页面隐藏 / 切换工作区', () => {
  assert.match(raw, /pagehide/, 'pagehide 时必须 flush（关页/刷新前的最后一次保存不能丢）')
  assert.match(raw, /visibilitychange/, '页面转入后台时必须 flush')
  assert.match(raw, /flush\(\)/, '必须存在 flush 调用')
  const flushCalls = [...code.matchAll(/\.flush\(\)/g)].length
  assert.ok(flushCalls >= 2, `flush 调用点过少（${flushCalls}）—— 至少覆盖"隐藏"与"卸载/切换"`)
})

test('W8 写入失败必须有可见反馈（禁止静默失败）', () => {
  assert.match(raw, /onError:/, '写入器必须挂 onError')
  assert.match(raw, /presetWriteFailedText\(/, '失败时必须用叶子文案提示用户')
  // 旧实现是 `function writePreset(v){ try { localStorage.setItem(...) } catch { /* ignore */ } }` ——
  // 必须改成"落盘失败就抛、由写入器的 onError 转成可见提示"。
  // 注意：判据必须落在**未剥注释的原文**上 —— 先前的写法在 code（已剥注释）里恒真，属伪测试。
  const at = raw.indexOf('function commitPresetStore')
  assert.ok(at > 0, '必须存在唯一的落盘函数 commitPresetStore')
  const body = raw.slice(at, raw.indexOf('\n}', at))
  assert.match(body, /localStorage\.setItem\(/, '落盘函数必须真的写 localStorage')
  assert.ok(!/catch/.test(body), '落盘函数里不得有任何 catch —— 失败必须抛给写入器的 onError 变成可见提示')
})

test('W9 多标签页最终一致：监听 storage 事件，且监听必须可回收', () => {
  assert.match(raw, /addEventListener\('storage'/, '必须监听 storage 事件（另一个标签页改了配置要同步）')
  assert.match(raw, /removeEventListener\('storage'/, 'storage 监听必须在 cleanup 里移除（否则热重载会叠加监听）')
})

test('W10 旧配置迁移：只迁一次、迁给当前工作区、随后删旧键', () => {
  assert.match(raw, /migrateLegacyPreset\(/, '必须调用迁移')
  assert.match(raw, /removeItem\(LEGACY_PRESET_KEY\)/, '迁移后必须删除旧键（否则每个新工作区都会被旧值污染）')
  assert.match(raw, /legacyMigratedRef|legacyMigrationDone/, '迁移必须只跑一次（页面内多处读取不得重复迁移）')
})

test('W11 新建工作区默认空白（验收 3）+ 提供「填入默认文案」按钮补回既有文案', () => {
  assert.match(raw, /DEFAULT_APPEND_TEXT/, '默认文案必须来自叶子常量')
  assert.match(raw, /填入默认文案/, '必须有「填入默认文案」按钮（用户 2026-09-23 选定：新工作区空白 + 一键填回）')
  assert.ok(!/getItem\([^)]*\)\s*\?\?\s*DEFAULT_APPEND_TEXT/.test(code), '读取缺省值不得再回落默认文案（会破坏"新建工作区为空"）')
})

test('W13 写盘失败要"保持内存态可用"：必须先更新内存再落盘（落盘抛错时本页仍拿到新值）', () => {
  const at = raw.indexOf('write: (request) =>')
  assert.ok(at > 0, '未找到写入器的 write 回调')
  const body = raw.slice(at, raw.indexOf('onApplied', at))
  const memAt = body.indexOf('cachedPresetStore =')
  const diskAt = body.indexOf('commitPresetStore(')
  assert.ok(memAt > 0 && diskAt > 0, `write 回调里必须既有内存更新也有落盘：${body.slice(0, 160)}`)
  assert.ok(memAt < diskAt, '顺序反了：必须先更新内存态再落盘，否则配额超限时这一笔编辑在本页也丢了（需求：降级时内存态可用）')
})

test('W12 追加逻辑与对外交互不变：拼接仍是「草稿 + 两个换行 + 文案」，空文案仍提示去设置', () => {
  assert.match(raw, /\\n\\n\$\{preset\}/, '拼接格式（两个换行）不得改变')
  assert.match(raw, /请右键设置追加文案/, '空文案时的既有提示必须保留')
  assert.match(raw, /preset,/, '请求体仍必须发送 preset（宿主契约，见 client-shape 冻结断言）')
})
