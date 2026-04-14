'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { GROUP_SLOTS } from '@/types'
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

type EditState = {
  id: string
  date: string
  lessonType: '個別指導' | '集団授業'
  periods: number
  slots: string[]
  extraMinutes: string
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
  const [saving, setSaving] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)

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
      supabase.from('itoshima_teachers').select('id, name, code').eq('is_admin', false).eq('is_juku_teacher', true).order('code'),
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

  const openEdit = (r: Attendance) => {
    setEdit({
      id: r.id,
      date: r.date,
      lessonType: r.lesson_type as '個別指導' | '集団授業',
      periods: r.periods,
      slots: r.notes ? r.notes.split('').filter((c) => ['①','②','③','④','⑤'].includes(c)) : [],
      extraMinutes: String(r.extra_minutes ?? 0),
    })
  }

  const toggleEditSlot = (label: string) => {
    if (!edit) return
    setEdit((prev) => {
      if (!prev) return prev
      const slots = prev.slots.includes(label)
        ? prev.slots.filter((s) => s !== label)
        : [...prev.slots, label]
      return { ...prev, slots }
    })
  }

  const saveEdit = async () => {
    if (!edit) return
    setSaving(true)

    const extra = parseInt(edit.extraMinutes) || 0
    let updateData: Record<string, unknown>

    if (edit.lessonType === '個別指導') {
      updateData = {
        date: edit.date,
        lesson_type: '個別指導',
        periods: edit.periods,
        start_time: null,
        end_time: null,
        extra_minutes: extra,
        notes: null,
      }
    } else {
      if (edit.slots.length === 0) { setSaving(false); return }
      const sorted = [...edit.slots].sort()
      const first = GROUP_SLOTS.find((s) => s.label === sorted[0])!
      const last = GROUP_SLOTS.find((s) => s.label === sorted[sorted.length - 1])!
      updateData = {
        date: edit.date,
        lesson_type: '集団授業',
        periods: edit.slots.length,
        start_time: first.start,
        end_time: last.end,
        extra_minutes: extra,
        notes: sorted.join(''),
      }
    }

    await supabase.from('itoshima_attendances').update(updateData).eq('id', edit.id)
    setSaving(false)
    setEdit(null)
    fetchData()
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
                  onClick={() => {
                    setExpandedId(expandedId === s.id ? null : s.id)
                    setEdit(null)
                  }}
                >
                  <div className="flex-1">
                    <p className="font-bold text-gray-800">{s.name}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-sm">
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
                        <div key={r.id}>
                          {/* 通常表示行 */}
                          {edit?.id !== r.id && (
                            <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-50 last:border-0">
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-700">{formatDate(r.date)}</span>
                                <span
                                  className="ml-2 text-xs px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: '#FFF0E0', color: '#CC5500' }}
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
                                onClick={() => openEdit(r)}
                                className="text-xs border px-2.5 py-1 rounded-lg shrink-0"
                                style={{ color: '#FF7F00', borderColor: '#FF7F00' }}
                              >
                                編集
                              </button>
                              <button
                                onClick={() => handleDelete(r.id)}
                                disabled={deletingId === r.id}
                                className="text-xs text-red-400 border border-red-200 px-2.5 py-1 rounded-lg disabled:opacity-40 shrink-0"
                              >
                                {deletingId === r.id ? '削除中' : '削除'}
                              </button>
                            </div>
                          )}

                          {/* 編集フォーム */}
                          {edit?.id === r.id && (
                            <div className="px-5 py-4 border-b border-gray-100 bg-orange-50 flex flex-col gap-4">

                              {/* 勤務日 */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">勤務日</label>
                                <input
                                  type="date"
                                  value={edit.date}
                                  onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FF7F00]"
                                />
                              </div>

                              {/* 授業種類 */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">授業の種類</label>
                                <div className="flex gap-2">
                                  {(['個別指導', '集団授業'] as const).map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setEdit({ ...edit, lessonType: type, slots: [], periods: 0 })}
                                      className="px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors"
                                      style={
                                        edit.lessonType === type
                                          ? { backgroundColor: '#FF7F00', borderColor: '#FF7F00', color: 'white' }
                                          : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                                      }
                                    >
                                      {type}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* 個別指導：コマ数 */}
                              {edit.lessonType === '個別指導' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">コマ数</label>
                                  <div className="flex gap-2">
                                    {[0, 1, 2, 3, 4, 5].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        onClick={() => setEdit({ ...edit, periods: n })}
                                        className="w-10 py-2 rounded-lg text-base font-bold border-2 transition-colors"
                                        style={
                                          edit.periods === n
                                            ? { backgroundColor: '#FF7F00', borderColor: '#FF7F00', color: 'white' }
                                            : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                                        }
                                      >
                                        {n}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 集団授業：スロット */}
                              {edit.lessonType === '集団授業' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">時間帯</label>
                                  <div className="flex gap-2 flex-wrap">
                                    {GROUP_SLOTS.map((slot) => {
                                      const isSelected = edit.slots.includes(slot.label)
                                      return (
                                        <button
                                          key={slot.label}
                                          type="button"
                                          onClick={() => toggleEditSlot(slot.label)}
                                          className="px-3 py-2 rounded-lg text-sm border-2 transition-colors"
                                          style={
                                            isSelected
                                              ? { backgroundColor: '#FF7F00', borderColor: '#FF7F00', color: 'white' }
                                              : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                                          }
                                        >
                                          {slot.label} {slot.start}〜
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* 追加業務時間 */}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">追加業務時間（分）</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={edit.extraMinutes}
                                    onChange={(e) => setEdit({ ...edit, extraMinutes: e.target.value })}
                                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-[#FF7F00]"
                                  />
                                  <span className="text-sm text-gray-500">分</span>
                                </div>
                              </div>

                              {/* 保存・キャンセル */}
                              <div className="flex gap-2">
                                <button
                                  onClick={saveEdit}
                                  disabled={saving}
                                  className="px-5 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-60"
                                  style={{ backgroundColor: '#FF7F00' }}
                                >
                                  {saving ? '保存中...' : '保存する'}
                                </button>
                                <button
                                  onClick={() => setEdit(null)}
                                  disabled={saving}
                                  className="px-5 py-2 rounded-lg text-sm text-gray-500 border border-gray-300 bg-white"
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          )}
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
