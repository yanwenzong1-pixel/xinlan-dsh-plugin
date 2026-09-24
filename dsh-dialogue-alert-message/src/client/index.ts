/**
 * @dsh-external/dsh-dialogue-alert-message — client half.
 * A status bar above the Settings button (`sidebar.footer.action`).
 * Polls the host status + usage APIs and plays short sounds when a dialogue
 * completes; plays interruption alarm sounds from the host's self-contained
 * notification service (host-side gate: total switch / mute-all / level filter
 * / DND already applied; client only plays and acks). The wide bar shows the
 * usage overview in the exact format: 对话: N，当日: X.XX元，余额: Y.YY元
 * (tabular-nums; '--' while unknown/failed). The collapsed icon button keeps
 * its original behavior. No other plugin is involved (v0.2.1).
 */
import { createElement, useEffect, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { fmtCount, fmtMoney2 } from '../lib/usage-stats.js'
import { replayDecision, REPLAY_MAP_CAP } from '../lib/alarm-replay.js'

type ClientContext = {
  slots: any
}

export const inject = ['slots']

const STATUS_URL = '/@dsh-external/dsh-dialogue-alert-message/api/status'
const USAGE_URL = '/@dsh-external/dsh-dialogue-alert-message/api/usage'
const ALARM_URL = '/@dsh-external/dsh-dialogue-alert-message/api/alarm'

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

function RunningIcon() {
  return createElement(
    'svg',
    {
      width: 18,
      height: 18,
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

  // 缺失态占位：首次加载未完成 → 全部 '--'；余额未知/刷新失败 → 仅余额 '--'。
  const text = usage === null
    ? '对话: --，当日: --元，余额: --元'
    : `对话: ${fmtCount(usage.dialogueCount)}，当日: ${fmtMoney2(usage.todayCost)}元，余额: ${fmtMoney2(usage.balance)}元`

  return createElement(
    'div',
    {
      style: {
        padding: '6px 10px',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--al-text2, #9AA3B2)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    },
    text,
  )
}
