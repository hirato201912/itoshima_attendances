'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { SHIFT_SLOTS } from '@/types'
import type { LoggedInTeacher } from '@/types'

// スロットごとの色定義（オレンジ系3段階）
const SLOT_COLORS: Record<number, { dot: string; activeBg: string; activeBorder: string; activeText: string }> = {
  1: { dot: '#F59E0B', activeBg: '#FFFBEB', activeBorder: '#F59E0B', activeText: '#92400E' },
  2: { dot: '#FF7F00', activeBg: '#FFF0E0', activeBorder: '#FF7F00', activeText: '#CC5500' },
  3: { dot: '#C2410C', activeBg: '#FEF0E7', activeBorder: '#C2410C', activeText: '#9A3412' },
}

// 休校日（特定日）
const CLOSED_DATES = new Set([
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
])

// 土日または休校日か判定
function isClosedDate(date: string) {
  const dow = new Date(date + 'T00:00:00').getDay()
  return dow === 0 || dow === 6 || CLOSED_DATES.has(date)
}

function currentMonthStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function getCalendarDays(yearMonth: string): (string | null)[] {
  const [year, month] = yearMonth.split('-').map(Number)
  const firstDow = new Date(year, month - 1, 1).getDay()
  const lastDate = new Date(year, month, 0).getDate()
  const days: (string | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= lastDate; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return days
}

type SlotKey = { date: string; slot: number }

export default function ShiftPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [viewMonth, setViewMonth] = useState(currentMonthStr)
  const [requests, setRequests] = useState<SlotKey[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'info' } | null>(null)
  const [loading, setLoading] = useState(true)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (!saved) { router.replace('/'); return }
    setTeacher(JSON.parse(saved))
  }, [router])

  const fetchRequests = useCallback(async (teacherId: string, month: string) => {
    setLoading(true)
    const [year, m] = month.split('-')
    const from = `${year}-${m}-01`
    const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate()
    const to = `${year}-${m}-${String(lastDay).padStart(2, '0')}`
    const { data } = await supabase
      .from('juku_shift_requests')
      .select('date, slot')
      .eq('teacher_id', teacherId)
      .gte('date', from)
      .lte('date', to)
    setRequests((data ?? []).map((r: { date: string; slot: number }) => ({ date: r.date, slot: r.slot })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!teacher) return
    fetchRequests(teacher.id, viewMonth)
    setSelectedDate(null)
  }, [teacher, viewMonth, fetchRequests])

  const today = todayStr()
  const [year, month] = viewMonth.split('-').map(Number)
  const monthLabel = `${year}年${month}月`

  const shiftPrevMonth = () => {
    const d = new Date(year, month - 2, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const shiftNextMonth = () => {
    const d = new Date(year, month, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const hasSlot = (date: string, slot: number) =>
    requests.some(r => r.date === date && r.slot === slot)

  const showToast = (text: string, type: 'success' | 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, type })
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }

  const toggleSlot = async (date: string, slot: number) => {
    if (!teacher || saving) return
    setSaving(true)
    if (hasSlot(date, slot)) {
      setRequests(prev => prev.filter(r => !(r.date === date && r.slot === slot)))
      await supabase
        .from('juku_shift_requests')
        .delete()
        .eq('teacher_id', teacher.id)
        .eq('date', date)
        .eq('slot', slot)
    } else {
      setRequests(prev => [...prev, { date, slot }])
      await supabase
        .from('juku_shift_requests')
        .insert({ teacher_id: teacher.id, date, slot })
    }
    setSaving(false)
    showToast('✓　保存しました', 'success')
  }

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  if (!teacher) return null

  const calendarDays = getCalendarDays(viewMonth)
  const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

  return (
    <div className="min-h-screen bg-gray-50">

      {/* トースト通知（画面中央） */}
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
          className="flex items-center gap-2.5 px-7 py-3.5 rounded-2xl shadow-xl text-base font-bold text-white whitespace-nowrap"
          style={{ backgroundColor: toast?.type === 'success' ? '#FF7F00' : '#6b7280' }}
        >
          {toast?.text}
        </div>
      </div>

      <header
        className="py-4 px-4 flex items-center justify-between shadow-md sticky top-0 z-20"
        style={{ backgroundColor: '#FF7F00' }}
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

      <main className="max-w-lg mx-auto px-4 py-6">
        {/* タイトル */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">空き時間帯のお知らせ</h2>
          <p className="text-sm text-gray-500 mt-1">
            入れる日・時間帯を選んでください。<br />
            予定が変わったらいつでも気軽に変更できます。
          </p>
        </div>

        {/* 月ナビゲーション */}
        <div className="flex items-center justify-between mb-3 bg-white rounded-2xl shadow-sm px-5 py-3">
          <button
            onClick={shiftPrevMonth}
            className="text-2xl text-gray-400 w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100"
          >
            ‹
          </button>
          <span className="text-lg font-bold text-gray-800">{monthLabel}</span>
          <button
            onClick={shiftNextMonth}
            className="text-2xl text-gray-400 w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100"
          >
            ›
          </button>
        </div>

        {/* カレンダー */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAY_LABELS.map((d, i) => (
              <div
                key={d}
                className="text-center text-xs font-bold py-2"
                style={{ color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#6b7280' }}
              >
                {d}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map((date, idx) => {
                if (!date) {
                  return <div key={`empty-${idx}`} className="border-b border-r border-gray-50 h-14" />
                }
                const dow = new Date(date + 'T00:00:00').getDay()
                const isPast = date < today
                const isClosed = isClosedDate(date)
                const isUnavailable = isPast || isClosed
                const isSelected = date === selectedDate
                const selectedSlots = SHIFT_SLOTS.filter(s => hasSlot(date, s.slot))
                const dayNum = parseInt(date.split('-')[2])

                const numColor = isUnavailable
                  ? '#c4c4c4'
                  : isSelected
                  ? 'white'
                  : dow === 0
                  ? '#ef4444'
                  : dow === 6
                  ? '#3b82f6'
                  : '#374151'

                return (
                  <button
                    key={date}
                    onClick={() => {
                      if (isPast) return
                      if (isClosed) {
                        showToast('この日は休校日です', 'info')
                        return
                      }
                      setSelectedDate(isSelected ? null : date)
                    }}
                    className="border-b border-r border-gray-50 h-14 flex flex-col items-center justify-start pt-1.5 pb-1 transition-colors"
                    style={{
                      backgroundColor: isUnavailable
                        ? '#F3F4F6'
                        : isSelected
                        ? '#FFF0E0'
                        : undefined,
                      cursor: isUnavailable ? 'default' : 'pointer',
                    }}
                  >
                    <span
                      className="text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full mb-0.5"
                      style={{
                        color: numColor,
                        backgroundColor: isSelected ? '#FF7F00' : undefined,
                      }}
                    >
                      {dayNum}
                    </span>
                    {/* スロットドット（横並び） */}
                    {!isUnavailable && (
                      <div className="flex flex-row gap-0.5 justify-center">
                        {selectedSlots.map(s => (
                          <span
                            key={s.slot}
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: SLOT_COLORS[s.slot].dot }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 休校日の注記 */}
        <p className="text-xs text-gray-400 mb-3 px-1">
          ※ グレーの日付（土日・休校日）は選択できません
        </p>

        {/* 凡例（横並び） */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-3 bg-white rounded-2xl shadow-sm">
          {SHIFT_SLOTS.map(s => (
            <span key={s.slot} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: SLOT_COLORS[s.slot].dot }}
              />
              {s.label}：{s.start}〜{s.end}
            </span>
          ))}
        </div>
      </main>

      {/* ボトムシート backdrop */}
      {selectedDate && (
        <div
          className="fixed inset-0 z-30"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSelectedDate(null)}
        />
      )}

      {/* ボトムシート本体 */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out"
        style={{ transform: selectedDate ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {selectedDate && (() => {
          const d = new Date(selectedDate + 'T00:00:00')
          const dayLabel = '日月火水木金土'[d.getDay()]
          return (
            <div className="px-5 pt-4 pb-8">
              {/* ハンドルバー */}
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <p className="text-base font-bold text-gray-800">
                  {d.getMonth() + 1}月{d.getDate()}日（{dayLabel}）
                </p>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="text-gray-400 text-2xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                >
                  ×
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {SHIFT_SLOTS.map(({ slot, label, start, end }) => {
                  const selected = hasSlot(selectedDate, slot)
                  const colors = SLOT_COLORS[slot]
                  return (
                    <button
                      key={slot}
                      onClick={() => toggleSlot(selectedDate, slot)}
                      disabled={saving}
                      className="flex items-center gap-3 px-4 py-4 rounded-xl border-2 text-left transition-colors disabled:opacity-60"
                      style={
                        selected
                          ? { backgroundColor: colors.activeBg, borderColor: colors.activeBorder }
                          : { backgroundColor: '#fafafa', borderColor: '#e5e7eb' }
                      }
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: colors.dot }}
                      />
                      <span
                        className="text-base font-bold shrink-0"
                        style={{ color: selected ? colors.activeBorder : '#9ca3af' }}
                      >
                        {label}
                      </span>
                      <span
                        className="text-base tabular-nums whitespace-nowrap"
                        style={{ color: selected ? colors.activeText : '#6b7280' }}
                      >
                        {start}〜{end}
                      </span>
                      {selected && (
                        <span className="ml-auto text-lg font-bold shrink-0" style={{ color: colors.activeBorder }}>✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">タップしてON/OFF・いつでも変更できます</p>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
