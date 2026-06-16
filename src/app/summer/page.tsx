'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { SUMMER_SLOTS, SUMMER_PERIOD } from '@/types'
import type { LoggedInTeacher } from '@/types'

const ORANGE = '#FF7F00'

type Row =
  | { type: 'date'; date: string; dow: number }
  | { type: 'closed'; label: string; rangeLabel: string }

function findClosedRange(dateStr: string) {
  return SUMMER_PERIOD.closedRanges.find(r => dateStr >= r.start && dateStr <= r.end)
}

function buildRows(): Row[] {
  const rows: Row[] = []
  const start = new Date(SUMMER_PERIOD.start + 'T00:00:00')
  const end = new Date(SUMMER_PERIOD.end + 'T00:00:00')
  const insertedRanges = new Set<string>()
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const ds = `${y}-${m}-${day}`
    const closed = findClosedRange(ds)
    if (closed) {
      if (!insertedRanges.has(closed.start)) {
        const sm = parseInt(closed.start.split('-')[1])
        const sd = parseInt(closed.start.split('-')[2])
        const em = parseInt(closed.end.split('-')[1])
        const ed = parseInt(closed.end.split('-')[2])
        const rangeLabel = (closed.start as string) === (closed.end as string)
          ? `${sm}/${sd}`
          : sm === em
          ? `${sm}/${sd}〜${ed}`
          : `${sm}/${sd}〜${em}/${ed}`
        rows.push({ type: 'closed', label: closed.label, rangeLabel })
        insertedRanges.add(closed.start)
      }
      continue
    }
    rows.push({ type: 'date', date: ds, dow })
  }
  return rows
}

export default function SummerPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (!saved) { router.replace('/'); return }
    const t = JSON.parse(saved) as LoggedInTeacher
    setTeacher(t)
  }, [router])

  const isAdmin = teacher?.is_admin === true

  const fetchData = useCallback(async (teacherId: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('juku_summer_availability')
      .select('date, slot')
      .eq('teacher_id', teacherId)
      .gte('date', SUMMER_PERIOD.start)
      .lte('date', SUMMER_PERIOD.end)
    const set = new Set<string>()
    for (const r of data ?? []) {
      set.add(`${r.date}_${r.slot}`)
    }
    setSelected(set)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!teacher) return
    fetchData(teacher.id)
  }, [teacher, fetchData])

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), 1600)
  }

  const has = (date: string, slot: number) => selected.has(`${date}_${slot}`)

  const toggleCell = async (date: string, slot: number) => {
    if (!teacher || saving) return
    const key = `${date}_${slot}`
    const isOn = selected.has(key)
    const next = new Set(selected)
    if (isOn) next.delete(key)
    else next.add(key)
    setSelected(next)
    setSaving(true)
    if (isOn) {
      await supabase
        .from('juku_summer_availability')
        .delete()
        .eq('teacher_id', teacher.id)
        .eq('date', date)
        .eq('slot', slot)
    } else {
      await supabase
        .from('juku_summer_availability')
        .insert({ teacher_id: teacher.id, date, slot })
    }
    setSaving(false)
    showToast('✓ 保存しました')
  }

  const setRowAll = async (date: string, on: boolean) => {
    if (!teacher || saving) return
    setSaving(true)
    const next = new Set(selected)
    for (const s of SUMMER_SLOTS) {
      const key = `${date}_${s.slot}`
      if (on) next.add(key)
      else next.delete(key)
    }
    setSelected(next)
    if (on) {
      const rows = SUMMER_SLOTS.map(s => ({ teacher_id: teacher.id, date, slot: s.slot }))
      await supabase.from('juku_summer_availability').upsert(rows, { onConflict: 'teacher_id,date,slot' })
    } else {
      await supabase
        .from('juku_summer_availability')
        .delete()
        .eq('teacher_id', teacher.id)
        .eq('date', date)
    }
    setSaving(false)
    showToast(on ? '✓ この日を全部○にしました' : '✓ この日をクリアしました')
  }

  const setAllPeriod = async (on: boolean) => {
    if (!teacher || saving) return
    if (on && !confirm('全期間・全コマを「出られる」に設定します。よろしいですか？')) return
    if (!on && !confirm('全期間の希望をすべてクリアします。よろしいですか？')) return
    setSaving(true)
    const rows = buildRows()
    const next = new Set<string>()
    if (on) {
      const inserts: { teacher_id: string; date: string; slot: number }[] = []
      for (const r of rows) {
        if (r.type !== 'date') continue
        for (const s of SUMMER_SLOTS) {
          next.add(`${r.date}_${s.slot}`)
          inserts.push({ teacher_id: teacher.id, date: r.date, slot: s.slot })
        }
      }
      setSelected(next)
      await supabase.from('juku_summer_availability').upsert(inserts, { onConflict: 'teacher_id,date,slot' })
    } else {
      setSelected(next)
      await supabase
        .from('juku_summer_availability')
        .delete()
        .eq('teacher_id', teacher.id)
        .gte('date', SUMMER_PERIOD.start)
        .lte('date', SUMMER_PERIOD.end)
    }
    setSaving(false)
    showToast(on ? '✓ 全期間○にしました' : '✓ 全期間クリアしました')
  }

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  if (!teacher) return null

  // 管理者はこのページから提出させない
  if (isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header
          className="py-4 px-4 flex items-center justify-between shadow-md sticky top-0 z-20"
          style={{ backgroundColor: ORANGE }}
        >
          <div>
            <p className="text-white/70 text-xs">糸島学習塾</p>
            <p className="text-white font-bold text-base">{teacher.name} 先生</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-white/90 text-sm underline underline-offset-2">
              管理画面
            </Link>
            <button onClick={handleLogout} className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg">
              ログアウト
            </button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow p-8 max-w-md text-center">
            <p className="text-3xl mb-3">🛠</p>
            <p className="text-lg font-bold text-gray-800 mb-2">
              管理者は夏期講習シフトを提出する必要はありません
            </p>
            <p className="text-sm text-gray-500 mb-6">
              講師の方々の希望シフトは、管理画面の「夏期講習」タブで確認できます。
            </p>
            <Link
              href="/admin"
              className="inline-block px-6 py-3 rounded-xl text-white font-bold"
              style={{ backgroundColor: ORANGE }}
            >
              管理画面へ
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const rows = buildRows()
  const totalCells = rows.filter(r => r.type === 'date').length * SUMMER_SLOTS.length
  const selectedCount = selected.size

  return (
    <div className="min-h-screen bg-gray-50">
      {/* トースト */}
      <div
        className="fixed left-1/2 z-50 pointer-events-none transition-all duration-300"
        style={{
          top: '45%',
          transform: toast
            ? 'translateX(-50%) translateY(-50%)'
            : 'translateX(-50%) translateY(calc(-50% - 12px))',
          opacity: toast ? 1 : 0,
        }}
      >
        <div
          className="px-7 py-3.5 rounded-2xl shadow-xl text-base font-bold text-white whitespace-nowrap"
          style={{ backgroundColor: ORANGE }}
        >
          {toast}
        </div>
      </div>

      {/* ヘッダー */}
      <header
        className="py-4 px-4 flex items-center justify-between shadow-md sticky top-0 z-20"
        style={{ backgroundColor: ORANGE }}
      >
        <div>
          <p className="text-white/70 text-xs">糸島学習塾</p>
          <p className="text-white font-bold text-base">{teacher.name} 先生</p>
        </div>
        <div className="flex items-center gap-3">
          {teacher.is_admin && (
            <Link href="/admin" className="text-white/90 text-sm underline underline-offset-2">
              管理画面
            </Link>
          )}
          <Link href="/attendance" className="text-white/90 text-sm underline underline-offset-2">
            勤怠入力
          </Link>
          <Link href="/history" className="text-white/90 text-sm underline underline-offset-2">
            履歴
          </Link>
          <button
            onClick={handleLogout}
            className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* タイトル */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">夏期講習のシフト希望</h2>
          <p className="text-sm text-gray-500 mt-1">
            出られる日・時間帯のセルをタップしてください。<br />
            予定が変わったらいつでも変更できます（自動保存）。
          </p>
        </div>

        {/* 時間帯凡例 */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3 mb-3 text-xs text-gray-600 grid grid-cols-2 gap-x-3 gap-y-1">
          {SUMMER_SLOTS.map(s => (
            <span key={s.slot} className="flex items-center gap-1.5 tabular-nums">
              <span className="font-bold" style={{ color: ORANGE }}>{s.label}</span>
              {s.start}〜{s.end}
            </span>
          ))}
        </div>

        {/* 一括ボタン＆進捗 */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button
            onClick={() => setAllPeriod(true)}
            disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg border-2 disabled:opacity-50"
            style={{ color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
          >
            全期間○
          </button>
          <button
            onClick={() => setAllPeriod(false)}
            disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg border-2 border-gray-300 text-gray-500 bg-white disabled:opacity-50"
          >
            全期間クリア
          </button>
          <span className="ml-auto text-xs text-gray-500">
            提出 <span className="font-bold text-gray-700">{selectedCount}</span> / {totalCells} コマ
          </span>
        </div>

        {/* マトリクス */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* ヘッダー行 */}
          <div className="flex items-center border-b border-gray-100 bg-orange-50 px-2 py-2 text-xs font-bold text-gray-600">
            <div className="w-14 shrink-0">日付</div>
            {SUMMER_SLOTS.map(s => (
              <div key={s.slot} className="flex-1 text-center" style={{ color: ORANGE }}>
                {s.label}
              </div>
            ))}
            <div className="w-12 shrink-0 text-center text-[10px] text-gray-500">一括</div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : (
            <div>
              {rows.map((row, idx) => {
                if (row.type === 'closed') {
                  return (
                    <div
                      key={`closed-${idx}`}
                      className="flex items-center justify-center gap-2 py-3 bg-gray-100 border-y border-gray-200 text-xs font-bold text-gray-500"
                    >
                      <span>━━ {row.label} {row.rangeLabel} ━━</span>
                    </div>
                  )
                }
                const dow = row.dow
                const dayLabel = '日月火水木金土'[dow]
                const dayNum = parseInt(row.date.split('-')[2])
                const month = parseInt(row.date.split('-')[1])
                const dateLabel = `${month}/${dayNum}`
                const dowColor = dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#374151'
                const rowBg = dow === 0 ? '#FFFAFA' : dow === 6 ? '#F8FAFF' : undefined
                const rowAllOn = SUMMER_SLOTS.every(s => has(row.date, s.slot))
                return (
                  <div
                    key={row.date}
                    className="flex items-center px-2 py-1.5 border-b border-gray-100"
                    style={{ backgroundColor: rowBg }}
                  >
                    <div className="w-14 shrink-0 text-sm tabular-nums" style={{ color: dowColor }}>
                      <span className="font-semibold">{dateLabel}</span>
                      <span className="ml-0.5 text-xs">({dayLabel})</span>
                    </div>
                    {SUMMER_SLOTS.map(s => {
                      const on = has(row.date, s.slot)
                      return (
                        <div key={s.slot} className="flex-1 flex justify-center">
                          <button
                            onClick={() => toggleCell(row.date, s.slot)}
                            disabled={saving}
                            className="w-9 h-9 rounded-lg border-2 flex items-center justify-center transition-colors disabled:opacity-60 active:scale-95"
                            style={
                              on
                                ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                                : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#d1d5db' }
                            }
                            aria-label={`${dateLabel} ${s.label} ${on ? '解除' : '選択'}`}
                          >
                            {on ? <span className="text-lg font-bold leading-none">✓</span> : <span className="text-xs">・</span>}
                          </button>
                        </div>
                      )
                    })}
                    <div className="w-12 shrink-0 flex justify-center">
                      <button
                        onClick={() => setRowAll(row.date, !rowAllOn)}
                        disabled={saving}
                        className="text-[10px] font-bold px-2 py-1.5 rounded-md border disabled:opacity-50"
                        style={
                          rowAllOn
                            ? { color: '#9ca3af', borderColor: '#e5e7eb', backgroundColor: 'white' }
                            : { color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }
                        }
                      >
                        {rowAllOn ? 'クリア' : '全○'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 px-1 text-center">
          セルをタップで ○ ⇄ 空欄・自動で保存されます
        </p>
      </main>
    </div>
  )
}
