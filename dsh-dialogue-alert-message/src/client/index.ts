/**
 * @dsh-external/dsh-dialogue-alert-message — client half.
 * A status bar above the Settings button (`sidebar.footer.action`).
 * Polls the host status + usage APIs and plays short sounds when a dialogue
 * completes; plays interruption alarm sounds from the host's self-contained
 * notification service (host-side gate: total switch / mute-all / level filter
 * / DND already applied; client only plays and acks). The wide bar shows the
 * usage overview via the shared pure formatter: 对话: N，余额: Y.YY元
 * (tabular-nums; '--' while unknown/failed; 「当日: X.XX元」已于 v0.2.2 按要求下屏). The collapsed
 * icon button keeps its original behavior. No other plugin is involved (v0.2.1).
 */
import { createElement, useEffect, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { statusTextOf } from '../lib/usage-stats.js'
import { COMPACT_ICON_WIDTH_PX, availableForText, shouldCompact } from '../lib/footer-fit.js'
import { replayDecision, REPLAY_MAP_CAP } from '../lib/alarm-replay.js'

type ClientContext = {
  slots: any
}

export const inject = ['slots']

const STATUS_URL = '/@dsh-external/dsh-dialogue-alert-message/api/status'
const USAGE_URL = '/@dsh-external/dsh-dialogue-alert-message/api/usage'
const ALARM_URL = '/@dsh-external/dsh-dialogue-alert-message/api/alarm'

/** 文本样式：可见文案与「隐藏测量节点」必须逐字一致，量出来的自然宽才可信。 */
const TEXT_FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif'
const TEXT_FONT_SIZE = 12
const TEXT_PADDING_X = 10

interface Counts {
  running: number
  error: number
  completed: number
}

interface LastEvent {
  seq: number
  type: 'completed' | 'error'
  sessionId: string
  time: number
}

interface StatusPayload {
  ok: boolean
  counts: Counts
  lastEvent: LastEvent | null
}

interface UsagePayload {
  ok: boolean
  data?: {
    dialogueCount: number
    todayCost: number
    balance: number | null
    updatedAt: number
  }
}

interface InternalAlarm {
  id: string
  sessionId: string
  kind: string
  level: string
  soundType: string
  volume: number
  durationMs: number
  ts: number
}

/** 音色映射：single 单音 / double 双脉冲 / triple 三连（本地降级发声按等级区分严重度）。 */
const SOUND_PATTERNS: Record<string, number[]> = {
  single: [660],
  double: [880, 660],
  triple: [880, 660, 880],
}

function playTone(frequencies: number[], durationMs: number, volume = 0.18): void {
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
    if (AudioContextClass === undefined) return
    const context = new AudioContextClass()
    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000)
    frequencies.forEach((freq, index) => {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      const start = context.currentTime + index * (durationMs / frequencies.length / 1000)
      osc.start(start)
      osc.stop(start + durationMs / frequencies.length / 1000)
    })
    setTimeout(() => { void context.close() }, durationMs + 50)
  } catch { /* audio unavailable */ }
}

function playCompleted(): void {
  playTone([880, 1320], 700) // 叮咚
}

function playInternalAlarm(item: InternalAlarm): void {
  const pattern = SOUND_PATTERNS[item.soundType] ?? SOUND_PATTERNS.single
  playTone(pattern, item.durationMs, item.volume)
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-dialogue-alert-message',
    order: 10,
  }, DialogueAlertBar))
}

function RunningIcon(size = 18) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    createElement('path', { d: 'M22 12h-4l-3 9L9 3l-3 9H2' }),
  )
}

function DialogueAlertBar({ wide, toggleSidebar }: { wide: boolean; toggleSidebar?: () => void }) {
  const [counts, setCounts] = useState<Counts>({ running: 0, error: 0, completed: 0 })
  const [usage, setUsage] = useState<NonNullable<UsagePayload['data']> | null>(null)
  const lastSeqRef = useRef(0)
  // 同一报警（id）播放计数：最多连续播放 3 次（防 ack 失败/多轮询导致无限循环）。
  const replayCountRef = useRef(new Map<string, number>())

  useEffect(() => {
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        const [statusRes, usageRes] = await Promise.allSettled([
          fetch(STATUS_URL),
          fetch(USAGE_URL),
        ])
        if (statusRes.status === 'fulfilled') {
          const body = await statusRes.value.json() as StatusPayload
          if (body.ok) {
            setCounts(body.counts)
            const event = body.lastEvent
            if (event && event.seq > lastSeqRef.current) {
              lastSeqRef.current = event.seq
              if (event.type === 'completed') playCompleted()
              // 错误/中断报警音由下方 /api/alarm 自包含通道发声（本插件自身，
              // 不与其他插件交互）；用户主动取消保持静默。
            }
          }
        }
        if (usageRes.status === 'fulfilled') {
          const body = await usageRes.value.json() as UsagePayload
          if (body.ok && body.data) setUsage(body.data)
        }
        // 本插件自包含报警发声通道（宿主已过门控；同一报警最多连续播放 3 次，防无限循环）。
        try {
          const alarmRes = await fetch(ALARM_URL)
          const alarmBody = await alarmRes.json() as { ok: boolean; items: InternalAlarm[] }
          if (alarmBody.ok && Array.isArray(alarmBody.items) && alarmBody.items.length > 0) {
            const toPlay: InternalAlarm[] = []
            for (const item of alarmBody.items) {
              const prev = replayCountRef.current.get(item.id) ?? 0
              const decision = replayDecision(prev)
              replayCountRef.current.set(item.id, decision.next)
              if (decision.play) toPlay.push(item)
            }
            if (replayCountRef.current.size > REPLAY_MAP_CAP) replayCountRef.current.clear()
            for (const item of toPlay) playInternalAlarm(item)
            // ack 全部条目（含已超 3 次者）：尽力清空队列，避免任何残留重播源。
            const ids = alarmBody.items.map((i) => i.id).filter((v) => typeof v === 'string' && v !== '')
            if (ids.length > 0) {
              void fetch(`${ALARM_URL}/ack`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ids }),
              }).catch(() => { /* ack 失败：客户端 3 次封顶兜底，不再无限重播 */ })
            }
          }
        } catch { /* 报警通道不可用：静默 */ }
      } catch { /* ignore */ }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 1000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [])

  // 底部动作行是**共享的一行 flex**：DSH 内置 Cordis 行根节点 `flex:0 0 auto; width:100%`
  // 会占满整行（2026-10-13 真机实测：行 256px、Cordis 层 256px、本插件被压成 clientWidth 20 /
  // scrollWidth 169）。这里实测「本插件可用宽度 vs 文案所需宽度」，装不下就降级成紧凑图标
  // （完整文案进 title 悬停可见），空间回来后自动恢复；判定在纯函数 shouldCompact（有单测）。
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [compact, setCompact] = useState(false)
  const text = statusTextOf(usage)

  useEffect(() => {
    if (!wide) return
    // 两个坑（真机踩到，2026-10-14）：
    // ① 直接父节点是 slot 的 `display: contents` 包装层（clientWidth 恒 0）⇒ 必须向上找真正有盒子的行；
    // ② 同一个 slot 的**所有占位者**都塞在同一个 `display: contents` 容器里 ⇒ 算「被占用宽度」时
    //    必须把 contents 后代展平成 flex 项，否则会把同行的 Cordis 行整块漏算，误判成"有空间"。
    const rowOf = (el: HTMLElement | null): HTMLElement | null => {
      let cur = el?.parentElement ?? null
      while (cur) {
        if (getComputedStyle(cur).display !== 'contents') return cur
        cur = cur.parentElement
      }
      return null
    }
    const flexItemsOf = (row: HTMLElement): HTMLElement[] => {
      const out: HTMLElement[] = []
      const walk = (el: HTMLElement): void => {
        for (const child of Array.from(el.children) as HTMLElement[]) {
          if (getComputedStyle(child).display === 'contents') walk(child)
          else out.push(child)
        }
      }
      walk(row)
      return out
    }
    const decide = (): void => {
      const root = rootRef.current
      const row = rowOf(root)
      if (!root || !row) return
      const required = (measureRef.current?.offsetWidth ?? 0) + TEXT_PADDING_X * 2
      let used = 0
      for (const item of flexItemsOf(row)) {
        if (item !== root) used += item.offsetWidth
      }
      const free = availableForText(row.clientWidth, used)
      setCompact((prev) => shouldCompact({ free, required, wasCompact: prev }))
    }
    decide()
    const observer = new ResizeObserver(decide)
    const row = rowOf(rootRef.current)
    if (row) {
      observer.observe(row)
      for (const item of flexItemsOf(row)) observer.observe(item)
    }
    return () => { observer.disconnect() }
  }, [wide, text])

  if (!wide) {
    return createElement(
      'button',
      {
        type: 'button',
        title: '对话运行状态：运行中，点击展开侧边栏',
        onClick: () => { if (toggleSidebar) toggleSidebar() },
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: 32,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--al-text, #E6E9EF)',
          cursor: 'pointer',
        },
      },
      RunningIcon(),
    )
  }

  // 隐藏测量节点：始终渲染，给出文案自然宽（不受当前是否已被挤压影响）。
  const measureNode = createElement('span', {
    ref: measureRef,
    'aria-hidden': true,
    style: {
      position: 'absolute',
      left: '-99999px',
      top: 0,
      visibility: 'hidden',
      whiteSpace: 'nowrap',
      fontSize: TEXT_FONT_SIZE,
      fontFamily: TEXT_FONT_FAMILY,
      fontVariantNumeric: 'tabular-nums',
    },
  }, text)

  // 空间不足：降级为紧凑图标（可完全落在侧栏右内侧，不被裁切），完整数据放 title。
  if (compact) {
    const tone = counts.error > 0 ? '#F87171' : counts.running > 0 ? '#60A5FA' : 'var(--al-text2, #9AA3B2)'
    return createElement(
      'div',
      {
        ref: rootRef,
        title: `对话运行状态：${text}（同行插件占满底部行，已收起为图标；悬停查看完整数据）`,
        'aria-label': `对话运行状态：${text}`,
        style: {
          flex: '0 0 auto',
          minWidth: 0,
          width: COMPACT_ICON_WIDTH_PX,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tone,
          overflow: 'hidden',
        },
      },
      RunningIcon(COMPACT_ICON_WIDTH_PX),
      measureNode,
    )
  }

  // 缺失态占位：首次加载未完成 → 全部 '--'；余额未知/刷新失败 → 仅余额 '--'。
  // 文案由纯函数 statusTextOf 统一给出（单测钉住；v0.2.2 起不再含「当日」）。
  return createElement(
    'div',
    {
      ref: rootRef,
      title: `对话运行状态：${text}`,
      style: {
        flex: '0 0 auto',
        minWidth: 0,
        padding: `6px ${TEXT_PADDING_X}px`,
        fontSize: TEXT_FONT_SIZE,
        lineHeight: '18px',
        color: 'var(--al-text2, #9AA3B2)',
        fontFamily: TEXT_FONT_FAMILY,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    },
    text,
    measureNode,
  )
}
