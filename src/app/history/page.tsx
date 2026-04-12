'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Attendance, LoggedInTeacher } from '@/types'

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
    if (!saved) {
      router.replace('/')
      return
    }
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

  const totalPeriods = attendances.reduce((sum, a) => sum + a.periods, 0)
  const totalExtra = attendances.reduce((sum, a) => sum + (a.extra_minutes ?? 0), 0)

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
          <Link
            href="/attendance"
            className="text-white/90 text-sm underline underline-offset-2"
          >
            勤怠入力
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">勤怠履歴</h2>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF7F00]"
          />
        </div>

        {/* 月集計 */}
        {!loading && attendances.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex justify-between items-center">
            <span className="text-gray-500 text-sm">{attendances.length}日 勤務</span>
            <div className="text-right">
              <p className="font-bold text-xl" style={{ color: '#FF7F00' }}>
                合計 {totalPeriods} コマ
              </p>
              {totalExtra > 0 && (
                <p className="text-sm text-gray-400">追加業務 {totalExtra}分</p>
              )}
            </div>
          </div>
        )}

        {/* 履歴リスト */}
        {loading ? (
          <p className="text-center text-gray-400 py-16">読み込み中...</p>
        ) : attendances.length === 0 ? (
          <p className="text-center text-gray-400 py-16">この月の記録はありません</p>
        ) : (
          <div className="flex flex-col gap-3">
            {attendances.map((a) => (
              <div key={a.id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-800">{formatDate(a.date)}</span>
                  <span className="font-bold text-xl" style={{ color: '#FF7F00' }}>
                    {a.periods} コマ
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className="px-3 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: '#FFF0E0', color: '#CC5500' }}
                  >
                    {a.lesson_type}
                  </span>
                  {/* 集団授業：選択スロット表示 */}
                  {a.lesson_type === '集団授業' && a.notes && (
                    <span className="text-gray-500">{a.notes}</span>
                  )}
                  {/* 集団授業：時間帯 */}
                  {a.lesson_type === '集団授業' && a.start_time && a.end_time && (
                    <span className="text-gray-400 tabular-nums">
                      {formatTime(a.start_time)} 〜 {formatTime(a.end_time)}
                    </span>
                  )}
                  {/* 追加業務時間 */}
                  {(a.extra_minutes ?? 0) > 0 && (
                    <span className="text-gray-400">＋{a.extra_minutes}分</span>
                  )}
                </div>
                {/* 個別指導の備考 */}
                {a.lesson_type === '個別指導' && a.notes && (
                  <p className="mt-2 text-sm text-gray-400 border-t border-gray-100 pt-2">
                    {a.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
