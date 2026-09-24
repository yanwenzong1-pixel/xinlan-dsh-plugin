/**
 * 「追加文案」的**按工作区隔离存储**叶子 —— 零依赖、无 DOM、无 IO（2026-09-23）。
 *
 * 为什么单独成层：
 *  1) `tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**；
 *     把"键怎么拼、脏数据怎么收敛、写失败怎么办"留在客户端，等于没有任何一道门能拦住它。
 *     下沉到这里之后，`npm run typecheck` 与 `node --test` 都能覆盖。
 *  2) 结构只有一处定义：键名、版本、占位键、默认文案，客户端只许引用常量，不得自己拼字符串。
 *
 * 设计口径（对应需求逐条）：
 *  · 唯一维度 = 工作区**ID**（不是展示名）：重命名不影响、同名的两个工作区互不串写（见 workspaceKeyOf）。
 *  · 惰性初始化：不存在的键读出来就是空串，**读取绝不写盘**（presetOf 是纯函数）。
 *  · 旧值迁移：老版本只有一个全局键；第一次读到它时迁给"当前工作区"，随后**删掉旧键** ——
 *    不删的话，将来每建一个新工作区都会被这段旧值污染（= 隔离失效）。
 *  · 写盘失败**不冒泡**：调用点在浏览器渲染路径上，抛出去会整页挂；失败转成 onError 回调 → 可见提示。
 */
export const PRESET_STORE_KEY = 'dsh-quick-append.presets'
export const LEGACY_PRESET_KEY = 'dsh-quick-append.text'
export const PRESET_STORE_VERSION = 1
/** 会话不归属任何工作区时的专用占位键（不用空串，避免与"非法输入"混淆）。 */
export const NO_WORKSPACE_KEY = '__no-workspace__'
/** 合并写入的窗口：窗口内对同一工作区的多次提交只落一次盘。 */
export const PRESET_WRITE_COALESCE_MS = 250
export const PRESET_SAVED_TEXT = '已保存'

/**
 * 默认文案（原 `DEFAULT_PRESET`）：**不再作为缺省值**——按需求，新建工作区的追加文案为空；
 * 这段文案改由弹窗里的「填入默认文案」按钮一键填回（用户 2026-09-23 选定）。
 *
 * 2026-09-23 内容修订（**用户指定原文**，逐字写入，只剥掉行尾空白这一处复制痕迹）：
 *   · 第 1 条改为「…扩展使需求更加精准。扩展后要结合项目实际现状，对合理性…」；
 *   · 附加约束首条新增「-使用Ponytail 的 full模式开发」；
 *   · 末三条（插件窗口UI / 插件安全 / 画布互动 三个具体规范文件名）合并为通用一条
 *     「-项目规范，安全规范，交互规范，严格遵守根目录配置文件：*.md」；
 *   · 条目符号沿用用户原文的「-」后不加空格写法（其余文字一字未改）。
 *   门禁：test/preset-store.test.mjs 的 A4 同时钉住"新措辞必须在"与"旧措辞必须不在"。
 */
export const DEFAULT_APPEND_TEXT = `最高优先级规则：
1、根据用户需求进行一次细节的扩展使需求更加精准。扩展后要结合项目实际现状，对合理性做一次逐条校验（如果发现不合理必须重写）。
2、将需求拆解为最小、可独立验证的原子化步骤，逐个完成。
3、TDD测试驱动开发：先写测试，再写实现，遵循红‑绿‑重构，禁止跳过测试直接写业务代码。

附加约束：
-使用Ponytail 的 full模式开发
-单元测试必须覆盖边界与异常输入，拒绝无效伪测试。
-列出业务关键验收场景。
-完成后输出简短的潜在风险。
-模糊需求直接提问，禁止脑补逻辑。
-项目规范，安全规范，交互规范，严格遵守根目录配置文件：*.md

输出顺序：原子步骤 → 验收场景 → 单元测试 → 实现代码 → 风险清单。`

export interface PresetEntry {
  readonly appendText: string
}

export interface PresetStore {
  readonly version: number
  readonly workspaces: Readonly<Record<string, PresetEntry>>
}

/** 工作区列表条目里本叶子依赖的最小子集（`WorkspaceView` 的结构兼容形）。 */
export interface WorkspaceItemLike {
  readonly workspaceId?: unknown
  readonly sessionIds?: unknown
}

export interface PresetWriteRequest {
  readonly key: string
  readonly text: string
}

export interface LegacyMigration {
  readonly store: PresetStore
  /** 是否真的把旧值迁进了目标工作区。 */
  readonly migrated: boolean
  /** 是否应当删除旧键（读出过字符串就必须删，否则会持续污染新工作区）。 */
  readonly dropLegacy: boolean
}

export interface CoalescingWriterOptions {
  readonly delayMs: number
  /** 真正落盘；抛错表示失败（由 onError 承接，不冒泡给调用方）。 */
  readonly write: (request: PresetWriteRequest) => void
  readonly onApplied?: (request: PresetWriteRequest) => void
  readonly onError?: (request: PresetWriteRequest, error: unknown) => void
  /** 注入计时器（默认 setTimeout/clearTimeout），单测用假计时器。 */
  readonly schedule?: (fn: () => void, delayMs: number) => unknown
  readonly cancel?: (handle: unknown) => void
}

export interface CoalescingWriter {
  /** 提交一次写入（同键覆盖，窗口内合并）。 */
  submit(key: string, text: string): void
  /** 立即落盘（保存/页面隐藏/卸载/切换工作区时调用）。 */
  flush(): void
  /** 尚未落盘的键（测试与调试用）。 */
  pending(): readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyPresetStore(): PresetStore {
  return { version: PRESET_STORE_VERSION, workspaces: {} }
}

/**
 * 宽容解析：任何脏输入（null/空串/非 JSON/标量/数组/条目非法）都收敛成"能读多少读多少"，**绝不抛**。
 * 版本字段只做归一化：遇到未来版本仍读取已知字段（前向兼容），不整包丢弃。
 */
export function parsePresetStore(raw: unknown): PresetStore {
  if (typeof raw !== 'string' || raw.trim() === '') return emptyPresetStore()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyPresetStore()
  }
  if (!isRecord(parsed)) return emptyPresetStore()
  const workspaces: Record<string, PresetEntry> = {}
  const source = parsed.workspaces
  if (isRecord(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (key === '' || !isRecord(value)) continue
      const text = value.appendText
      // 只接受字符串：数字/null/对象一律丢弃该条目（不猜、不转换）。
      if (typeof text !== 'string') continue
      workspaces[key] = { appendText: text }
    }
  }
  return { version: PRESET_STORE_VERSION, workspaces }
}

export function serializePresetStore(store: PresetStore): string {
  return JSON.stringify({ version: PRESET_STORE_VERSION, workspaces: store.workspaces })
}

/** 读取某个工作区的追加文案：不存在 → 空串（惰性初始化，不产生写入）。 */
export function presetOf(store: PresetStore, workspaceKey: string): string {
  const entry: PresetEntry | undefined = store.workspaces[workspaceKey]
  return typeof entry?.appendText === 'string' ? entry.appendText : ''
}

/** 不可变写入：返回新 store，原对象不动（避免"读到一半被改"的隐式共享）。 */
export function withPreset(store: PresetStore, workspaceKey: string, text: string): PresetStore {
  return {
    version: PRESET_STORE_VERSION,
    workspaces: { ...store.workspaces, [workspaceKey]: { appendText: text } },
  }
}

/**
 * 解析"当前工作区键"：按 DSH 自己的口径 —— 工作区列表里 `sessionIds` 含当前会话的那个 `workspaceId`。
 * 解析不出来（无会话/未归属）→ NO_WORKSPACE_KEY。任何脏输入都不抛。
 *
 * 为什么必须按 ID：展示名可改、可重名；用名字当键会同时坏掉"重命名保留配置"和"同名工作区隔离"。
 */
export function workspaceKeyOf(input: {
  readonly sessionId?: unknown
  readonly items?: unknown
}): string {
  const sessionId = input.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return NO_WORKSPACE_KEY
  if (!Array.isArray(input.items)) return NO_WORKSPACE_KEY
  for (const item of input.items) {
    if (!isRecord(item)) continue
    const workspaceId = item.workspaceId
    if (typeof workspaceId !== 'string' || workspaceId === '') continue
    const sessionIds = item.sessionIds
    if (!Array.isArray(sessionIds)) continue
    if (sessionIds.includes(sessionId)) return workspaceId
  }
  return NO_WORKSPACE_KEY
}

/**
 * 旧版全局配置迁移：只在目标工作区**还没有**条目时迁入；只要读到过字符串就要求删旧键。
 * `legacyRaw` 非字符串（键不存在，或 storage 读取失败）→ 什么都不做且**不删键**（下次启动可重试）。
 */
export function migrateLegacyPreset(
  store: PresetStore,
  legacyRaw: unknown,
  workspaceKey: string,
): LegacyMigration {
  if (typeof legacyRaw !== 'string') return { store, migrated: false, dropLegacy: false }
  const hasEntry = Object.prototype.hasOwnProperty.call(store.workspaces, workspaceKey)
  if (legacyRaw === '' || hasEntry) return { store, migrated: false, dropLegacy: true }
  return { store: withPreset(store, workspaceKey, legacyRaw), migrated: true, dropLegacy: true }
}

/**
 * 合并写入器：窗口内同一键的多次提交合并成一次落盘（保留最后一次的值）；
 * `flush()` 立即落盘并撤销计时器。写入异常**不冒泡**，转 onError（写盘失败要让用户看见，但不能让页面挂）。
 */
export function createCoalescingWriter(options: CoalescingWriterOptions): CoalescingWriter {
  const schedule = options.schedule ?? ((fn: () => void, delayMs: number): unknown => setTimeout(fn, delayMs))
  const cancel = options.cancel ?? ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>) })
  const queue = new Map<string, string>()
  let handle: unknown = null

  const drain = (): void => {
    handle = null
    if (queue.size === 0) return
    const entries = [...queue.entries()]
    queue.clear()
    for (const [key, text] of entries) {
      const request: PresetWriteRequest = { key, text }
      try {
        options.write(request)
        options.onApplied?.(request)
      } catch (error) {
        options.onError?.(request, error)
      }
    }
  }

  return {
    submit(key: string, text: string): void {
      queue.set(key, text)
      if (handle === null) handle = schedule(drain, options.delayMs)
    },
    flush(): void {
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
      drain()
    },
    pending(): readonly string[] {
      return [...queue.keys()]
    },
  }
}

/**
 * 写盘失败的可见文案。两条硬要求：
 *  ① 不得为空（空提示 = 静默失败）；
 *  ② 必须讲清降级形态 —— "本页仍可用、刷新后会丢"，否则用户会以为这一笔编辑彻底没了。
 */
export function presetWriteFailedText(reason: unknown): string {
  const raw = typeof reason === 'string'
    ? reason
    : reason instanceof Error ? reason.message : ''
  const detail = raw.trim()
  const fallback = '本地存储不可用'
  const hint = '（当前页面内仍可继续使用，刷新后会丢失）'
  return detail === ''
    ? `追加文案保存失败：${fallback}${hint}`
    : `追加文案保存失败：${detail}${hint}`
}
