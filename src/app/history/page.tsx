'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Attendance, LoggedInTeacher } from '@/types'

const EARLY_SLOTS = ['①', '②']
const LATE_SLOTS = ['③', '④', '⑤']

function formatTime(t: string) {
  return t.slice(0, 5)
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getMonth() + 1}月${date.getDate()}日（${day}）`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function HistoryPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (!saved) { router.replace('/'); return }
    setTeacher(JSON.parse(saved))
  }, [router])

  useEffect(() => {
    if (!teacher) return
    setLoading(true)
    const [year, month] = selectedMonth.split('-')
    const from = `${year}-${month}-01`
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
    const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`

    supabase
      .from('itoshima_attendances')
      .select('*')
      .eq('teacher_id', teacher.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .then(({ data }) => {
        setAttendances(data ?? [])
        setLoading(false)
      })
  }, [teacher, selectedMonth])

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  // 日付ごとにグループ化（降順）
  const grouped = attendances.reduce<Record<string, Attendance[]>>((acc, a) => {
    if (!acc[a.date]) acc[a.date] = []
    acc[a.date].push(a)
    return acc
  }, {})
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // 集計
  const totalPeriods = attendances.reduce((s, a) => s + a.periods, 0)
  const totalExtra = attendances.reduce((s, a) => s + (a.extra_minutes ?? 0), 0)
  const workingDays = sortedDates.length
  const individualPeriods = attendances
    .filter((a) => a.lesson_type === '個別指導')
    .reduce((s, a) => s + a.periods, 0)

  let groupPeriodsEarly = 0
  let groupPeriodsLate = 0
  attendances.filter((a) => a.lesson_type === '集団授業').forEach((a) => {
    const notes = a.notes ?? ''
    groupPeriodsEarly += [...notes].filter((c) => EARLY_SLOTS.includes(c)).length
    groupPeriodsLate += [...notes].filter((c) => LATE_SLOTS.includes(c)).length
  })

  if (!teacher) return null

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
          <Link href="/shift" className="text-white/90 text-sm underline underline-offset-2">
            空き時間登録
          </Link>
          <button onClick={handleLogout} className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg">
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* 月選択 */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-800">勤怠履歴</h2>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF7F00]"
          />
        </div>

        {/* 月次サマリーカード */}
        {!loading && attendances.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="font-bold text-gray-700">月間まとめ</p>
              <p className="text-sm text-gray-400">{workingDays}日 勤務</p>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">個別指導</p>
                <p className="text-2xl font-bold text-gray-800">
                  {individualPeriods}<span className="text-sm font-normal text-gray-500 ml-1">コマ</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">集団授業 ①②</p>
                <p className="text-2xl font-bold text-gray-800">
                  {groupPeriodsEarly}<span className="text-sm font-normal text-gray-500 ml-1">コマ</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">追加業務時間</p>
                <p className="text-2xl font-bold text-gray-800">
                  {totalExtra}<span className="text-sm font-normal text-gray-500 ml-1">分</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">集団授業 ③以降</p>
                <p className="text-2xl font-bold text-gray-800">
                  {groupPeriodsLate}<span className="text-sm font-normal text-gray-500 ml-1">コマ</span>
                </p>
              </div>
            </div>
            <div
              className="px-5 py-3 border-t border-gray-100 flex justify-between items-center"
              style={{ backgroundColor: '#FFF7ED' }}
            >
              <p className="text-sm font-bold text-gray-600">合計コマ数</p>
              <p className="text-2xl font-bold" style={{ color: '#FF7F00' }}>{totalPeriods} コマ</p>
            </div>
          </div>
        )}

        {/* 履歴リスト（日付ごとにグループ化） */}
        {loading ? (
          <p className="text-center text-gray-400 py-16">読み込み中...</p>
        ) : sortedDates.length === 0 ? (
          <p className="text-center text-gray-400 py-16">この月の記録はありません</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold text-gray-500 px-1">勤務記録</p>
            {sortedDates.map((date) => {
              const dayRecords = grouped[date]
              const dayTotal = dayRecords.reduce((s, a) => s + a.periods, 0)
              const dayExtra = dayRecords.reduce((s, a) => s + (a.extra_minutes ?? 0), 0)

              return (
                <div key={date} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  {/* 日付ヘッダー */}
                  <div
                    className="px-4 py-3 flex items-center justify-between"
                    style={{ backgroundColor: '#FFF7ED' }}
                  >
                    <p className="font-bold text-gray-800">{formatDate(date)}</p>
                    <div className="text-right">
                      <span className="text-xl font-bold" style={{ color: '#FF7F00' }}>{dayTotal}</span>
                      <span className="text-sm text-gray-400 ml-1">コマ</span>
                    </div>
                  </div>

                  {/* その日の各勤務 */}
                  <div className="divide-y divide-gray-100">
                    {dayRecords.map((a) => {
                      const isIndividual = a.lesson_type === '個別指導'
                      return (
                        <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                          {/* 種別バッジ */}
                          <span
                            className="text-xs font-bold px-2.5 py-1 rounded-lg shrink-0"
                            style={
                              isIndividual
                                ? { backgroundColor: '#FFEDD5', color: '#C2410C' }
                                : { backgroundColor: '#DBEAFE', color: '#1D4ED8' }
                            }
                          >
                            {isIndividual ? '個別' : '集団'}
                          </span>

                          {/* 内容 */}
                          <div className="flex-1 min-w-0">
                            {isIndividual ? (
                              <span className="text-sm text-gray-700">{a.periods}コマ</span>
                            ) : (
                              <span className="text-sm text-gray-700">
                                {a.notes && <span className="font-bold mr-1">{a.notes}</span>}
                                {a.start_time && a.end_time && (
                                  <span className="text-gray-400 tabular-nums text-xs">
                                    {formatTime(a.start_time)} 〜 {formatTime(a.end_time)}
                                  </span>
                                )}
                                <span className="ml-2">{a.periods}コマ</span>
                              </span>
                            )}
                            {(a.extra_minutes ?? 0) > 0 && (
                              <span className="ml-2 text-xs text-gray-400">＋{a.extra_minutes}分</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* その日の追加業務時間（合計） */}
                  {dayExtra > 0 && (
                    <div className="px-4 py-2 border-t border-gray-100">
                      <p className="text-xs text-gray-400">追加業務時間 合計 {dayExtra}分</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
