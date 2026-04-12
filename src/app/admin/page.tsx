'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Attendance, LoggedInTeacher } from '@/types'

type TeacherSummary = {
  id: string
  name: string
  code: number
  individualPeriods: number
  groupPeriods: number
  extraMinutes: number
  workingDays: number
  records: Attendance[]
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getMonth() + 1}/${date.getDate()}（${day}）`
}

export default function AdminPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (!saved) { router.replace('/'); return }
    const t: LoggedInTeacher = JSON.parse(saved)
    if (!t.is_admin) { router.replace('/attendance'); return }
    setTeacher(t)
  }, [router])

  useEffect(() => {
    if (!teacher) return
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher, selectedMonth])

  const fetchData = async () => {
    setLoading(true)
    const [year, month] = selectedMonth.split('-')
    const from = `${year}-${month}-01`
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
    const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`

    const [{ data: teachers }, { data: records }] = await Promise.all([
      supabase.from('itoshima_teachers').select('id, name, code').eq('is_admin', false).order('code'),
      supabase.from('itoshima_attendances').select('*').gte('date', from).lte('date', to),
    ])

    if (!teachers || !records) { setLoading(false); return }

    const result: TeacherSummary[] = teachers.map((t) => {
      const tr = records.filter((r) => r.teacher_id === t.id)
      return {
        id: t.id,
        name: t.name,
        code: t.code,
        individualPeriods: tr.filter((r) => r.lesson_type === '個別指導').reduce((s, r) => s + r.periods, 0),
        groupPeriods: tr.filter((r) => r.lesson_type === '集団授業').reduce((s, r) => s + r.periods, 0),
        extraMinutes: tr.reduce((s, r) => s + (r.extra_minutes ?? 0), 0),
        workingDays: new Set(tr.map((r) => r.date)).size,
        records: tr.sort((a, b) => b.date.localeCompare(a.date)),
      }
    })

    setSummaries(result)
    setLoading(false)
  }

  const handleDelete = async (recordId: string) => {
    if (!confirm('この記録を削除しますか？')) return
    setDeletingId(recordId)
    await supabase.from('itoshima_attendances').delete().eq('id', recordId)
    setDeletingId(null)
    fetchData()
  }

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  if (!teacher) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <header
        className="py-4 px-4 flex items-center justify-between shadow-md sticky top-0 z-20"
        style={{ backgroundColor: '#FF7F00' }}
      >
        <div>
          <p className="text-white/70 text-xs">糸島学習塾</p>
          <p className="text-white font-bold text-base">管理画面</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/attendance" className="text-white/90 text-sm underline underline-offset-2">
            勤怠入力
          </Link>
          <button onClick={handleLogout} className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg">
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-800">月次サマリー</h2>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF7F00]"
          />
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-16">読み込み中...</p>
        ) : (
          <div className="flex flex-col gap-3">
            {summaries.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {/* サマリー行 */}
                <button
                  className="w-full px-5 py-4 flex items-center gap-3 text-left"
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                >
                  <div className="flex-1">
                    <p className="font-bold text-gray-800">{s.name}</p>
                    <div className="flex gap-4 mt-1.5 text-sm">
                      <span className="text-gray-500">個別 <span className="font-bold text-gray-800">{s.individualPeriods}</span>コマ</span>
                      <span className="text-gray-500">集団 <span className="font-bold text-gray-800">{s.groupPeriods}</span>コマ</span>
                      <span className="text-gray-500">勤務 <span className="font-bold text-gray-800">{s.workingDays}</span>日</span>
                      {s.extraMinutes > 0 && (
                        <span className="text-gray-500">業務 <span className="font-bold text-gray-800">{s.extraMinutes}</span>分</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold" style={{ color: '#FF7F00' }}>
                      {s.individualPeriods + s.groupPeriods}
                    </p>
                    <p className="text-xs text-gray-400">合計コマ</p>
                  </div>
                  <span className="text-gray-400 text-lg ml-1">
                    {expandedId === s.id ? '▲' : '▼'}
                  </span>
                </button>

                {/* 詳細レコード */}
                {expandedId === s.id && (
                  <div className="border-t border-gray-100">
                    {s.records.length === 0 ? (
                      <p className="text-center text-gray-400 py-4 text-sm">記録がありません</p>
                    ) : (
                      s.records.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-50 last:border-0">
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-700">{formatDate(r.date)}</span>
                            <span
                              className="ml-2 text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: r.lesson_type === '個別指導' ? '#FFF0E0' : '#FFF0F0', color: '#CC5500' }}
                            >
                              {r.lesson_type}
                            </span>
                            <span className="ml-2 text-sm text-gray-600">
                              {r.lesson_type === '集団授業' && r.notes ? `${r.notes} ` : ''}
                              {r.periods}コマ
                            </span>
                            {(r.extra_minutes ?? 0) > 0 && (
                              <span className="ml-1 text-xs text-gray-400">＋{r.extra_minutes}分</span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={deletingId === r.id}
                            className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-lg disabled:opacity-40"
                          >
                            {deletingId === r.id ? '削除中' : '削除'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
