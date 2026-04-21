'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { SHIFT_SLOTS } from '@/types'
import type { LoggedInTeacher } from '@/types'

function nextMonthStr() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
  const [viewMonth, setViewMonth] = useState(nextMonthStr)
  const [requests, setRequests] = useState<SlotKey[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [loading, setLoading] = useState(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const showSaved = () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setSavedMsg(true)
    savedTimer.current = setTimeout(() => setSavedMsg(false), 1800)
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
    showSaved()
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

        {/* 保存フィードバック */}
        <div
          className="overflow-hidden transition-all duration-300"
          style={{ maxHeight: savedMsg ? '60px' : '0', marginBottom: savedMsg ? '12px' : '0' }}
        >
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
            style={{ backgroundColor: '#ECFDF5', color: '#065F46' }}
          >
            <span className="text-base">✓</span> 保存しました
          </div>
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

          {/* 日付グリッド */}
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map((date, idx) => {
                if (!date) {
                  return <div key={`empty-${idx}`} className="border-b border-r border-gray-50 min-h-16" />
                }
                const dow = new Date(date + 'T00:00:00').getDay()
                const isPast = date < today
                const isSelected = date === selectedDate
                const slots = SHIFT_SLOTS.filter(s => hasSlot(date, s.slot))
                const dayNum = parseInt(date.split('-')[2])

                const numColor = isPast
                  ? '#d1d5db'
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
                      setSelectedDate(isSelected ? null : date)
                    }}
                    disabled={isPast}
                    className="border-b border-r border-gray-50 min-h-16 flex flex-col items-center pt-1.5 pb-1 gap-0.5 transition-colors"
                    style={{
                      backgroundColor: isSelected ? '#FFF0E0' : slots.length > 0 ? '#FFFBF5' : undefined,
                    }}
                  >
                    <span
                      className="text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full"
                      style={{
                        color: numColor,
                        backgroundColor: isSelected ? '#FF7F00' : undefined,
                      }}
                    >
                      {dayNum}
                    </span>
                    <div className="flex flex-col gap-0.5 w-full px-0.5">
                      {slots.map(s => (
                        <span
                          key={s.slot}
                          className="text-[8px] font-bold text-center leading-3 py-0.5 rounded"
                          style={{ backgroundColor: '#FF7F00', color: 'white' }}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ボトムシート用の余白（シートが凡例を隠さないよう） */}
        <div className="h-2" />

        {/* 凡例 */}
        <div className="flex flex-col gap-1.5 px-4 py-3 bg-white rounded-2xl shadow-sm text-sm text-gray-500">
          {SHIFT_SLOTS.map(s => (
            <span key={s.slot} className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded w-7 text-center" style={{ backgroundColor: '#FF7F00', color: 'white' }}>{s.label}</span>
              {s.start}〜{s.end}
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
                  return (
                    <button
                      key={slot}
                      onClick={() => toggleSlot(selectedDate, slot)}
                      disabled={saving}
                      className="flex items-center gap-4 px-4 py-4 rounded-xl border-2 text-left transition-colors disabled:opacity-60"
                      style={
                        selected
                          ? { backgroundColor: '#FFF0E0', borderColor: '#FF7F00' }
                          : { backgroundColor: '#fafafa', borderColor: '#e5e7eb' }
                      }
                    >
                      <span
                        className="text-base font-bold w-8 text-center shrink-0"
                        style={{ color: selected ? '#FF7F00' : '#9ca3af' }}
                      >
                        {label}
                      </span>
                      <span className="text-base tabular-nums" style={{ color: selected ? '#CC5500' : '#6b7280' }}>
                        {start} 〜 {end}
                      </span>
                      {selected
                        ? <span className="ml-auto text-lg font-bold" style={{ color: '#FF7F00' }}>✓</span>
                        : <span className="ml-auto text-sm text-gray-300">タップして登録</span>
                      }
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
