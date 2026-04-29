'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { GROUP_SLOTS, SHIFT_SLOTS } from '@/types'
import type { Attendance, LoggedInTeacher } from '@/types'

const ORANGE = '#FF7F00'

type TeacherSummary = {
  id: string
  name: string
  code: number
  individualPeriods: number
  groupPeriodsEarly: number
  groupPeriodsLate: number
  extraMinutes: number
  workingDays: number
  records: Attendance[]
}

type FormState = {
  date: string
  lessonType: '個別指導' | '集団授業'
  periods: number
  slots: string[]
  extraMinutes: string
}

type EditState = FormState & { id: string }
type NewState  = FormState & { teacherId: string }

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatDate(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getMonth() + 1}/${date.getDate()}（${day}）`
}

function fmtMin(min: number): string {
  if (min === 0) return '0分'
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}

function buildInsertOrUpdate(form: FormState): Record<string, unknown> | null {
  const extra = parseInt(form.extraMinutes) || 0
  if (form.lessonType === '個別指導') {
    if (form.periods === 0) return null
    return { date: form.date, lesson_type: '個別指導', periods: form.periods, start_time: null, end_time: null, extra_minutes: extra, notes: null }
  } else {
    if (form.slots.length === 0) return null
    const sorted = [...form.slots].sort()
    const first = GROUP_SLOTS.find(s => s.label === sorted[0])!
    const last  = GROUP_SLOTS.find(s => s.label === sorted[sorted.length - 1])!
    return { date: form.date, lesson_type: '集団授業', periods: form.slots.length, start_time: first.start, end_time: last.end, extra_minutes: extra, notes: sorted.join('') }
  }
}

// 編集・新規共通フォーム（PC横並びレイアウト）
function RecordForm({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  title,
}: {
  form: FormState
  onChange: (patch: Partial<FormState>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  title: string
}) {
  const toggleSlot = (label: string) => {
    const slots = form.slots.includes(label)
      ? form.slots.filter(s => s !== label)
      : [...form.slots, label]
    onChange({ slots })
  }

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-4">
      <p className="text-sm font-bold text-orange-700 mb-4">{title}</p>
      <div className="grid grid-cols-3 gap-6">

        {/* 列1：日付・種別 */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">勤務日</label>
            <input
              type="date"
              value={form.date}
              onChange={e => onChange({ date: e.target.value })}
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FF7F00]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">授業の種類</label>
            <div className="flex gap-2">
              {(['個別指導', '集団授業'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onChange({ lessonType: type, slots: [], periods: 0 })}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-colors"
                  style={
                    form.lessonType === type
                      ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                  }
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 列2：コマ数 or スロット */}
        <div>
          {form.lessonType === '個別指導' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">コマ数</label>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ periods: n })}
                    className="py-2 rounded-lg text-sm font-bold border-2 transition-colors"
                    style={
                      form.periods === n
                        ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                        : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">時間帯（複数選択可）</label>
              <div className="space-y-1.5">
                {GROUP_SLOTS.map(slot => {
                  const isSelected = form.slots.includes(slot.label)
                  return (
                    <button
                      key={slot.label}
                      type="button"
                      onClick={() => toggleSlot(slot.label)}
                      className="w-full px-3 py-2 rounded-lg text-sm border-2 text-left transition-colors"
                      style={
                        isSelected
                          ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                          : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                      }
                    >
                      {slot.label}　{slot.start} 〜 {slot.end}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 列3：追加業務・保存 */}
        <div className="space-y-4 flex flex-col justify-between">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">追加業務時間（分）</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={form.extraMinutes}
              onChange={e => onChange({ extraMinutes: e.target.value })}
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-[#FF7F00]"
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="w-full py-2.5 rounded-lg text-white text-sm font-bold disabled:opacity-60"
              style={{ backgroundColor: ORANGE }}
            >
              {saving ? '保存中...' : '保存する'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="w-full py-2.5 rounded-lg text-sm text-gray-500 border border-gray-300 bg-white"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type ShiftRow = {
  date: string
  teacher_id: string
  slot: number
  teacher_name: string
}

export default function AdminPage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [activeTab, setActiveTab] = useState<'attendance' | 'shift'>('attendance')

  // 勤怠タブ
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherSummary | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [newRecord, setNewRecord] = useState<NewState | null>(null)

  // シフトタブ
  const [shiftMonth, setShiftMonth] = useState(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [shiftRows, setShiftRows] = useState<ShiftRow[]>([])
  const [shiftLoading, setShiftLoading] = useState(false)

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

  // シフトデータ取得＋リアルタイム購読
  useEffect(() => {
    if (!teacher) return

    const fetchShift = async () => {
      setShiftLoading(true)
      const [year, m] = shiftMonth.split('-')
      const from = `${year}-${m}-01`
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate()
      const to = `${year}-${m}-${String(lastDay).padStart(2, '0')}`

      const [{ data: reqRows }, { data: teachers }] = await Promise.all([
        supabase
          .from('juku_shift_requests')
          .select('date, teacher_id, slot')
          .gte('date', from)
          .lte('date', to)
          .order('date'),
        supabase
          .from('itoshima_teachers')
          .select('id, name'),
      ])

      const teacherMap: Record<string, string> = {}
      for (const t of teachers ?? []) {
        teacherMap[t.id] = t.name
      }

      const mapped: ShiftRow[] = (reqRows ?? []).map((r: { date: string; teacher_id: string; slot: number }) => ({
        date: r.date,
        teacher_id: r.teacher_id,
        slot: r.slot,
        teacher_name: teacherMap[r.teacher_id] ?? '不明',
      }))
      setShiftRows(mapped)
      setShiftLoading(false)
    }

    fetchShift()

    // リアルタイム購読
    const channel = supabase
      .channel('shift-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'juku_shift_requests' },
        () => { fetchShift() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher, shiftMonth])

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

    const EARLY_SLOTS = ['①', '②']
    const LATE_SLOTS  = ['③', '④', '⑤']

    const result: TeacherSummary[] = teachers.map(t => {
      const tr = records.filter(r => r.teacher_id === t.id)
      let groupPeriodsEarly = 0, groupPeriodsLate = 0
      tr.filter(r => r.lesson_type === '集団授業').forEach(r => {
        const notes = r.notes ?? ''
        groupPeriodsEarly += [...notes].filter(c => EARLY_SLOTS.includes(c)).length
        groupPeriodsLate  += [...notes].filter(c => LATE_SLOTS.includes(c)).length
      })
      return {
        id: t.id, name: t.name, code: t.code,
        individualPeriods: tr.filter(r => r.lesson_type === '個別指導').reduce((s, r) => s + r.periods, 0),
        groupPeriodsEarly, groupPeriodsLate,
        extraMinutes: tr.reduce((s, r) => s + (r.extra_minutes ?? 0), 0),
        workingDays: new Set(tr.map(r => r.date)).size,
        records: tr.sort((a, b) => a.date.localeCompare(b.date)),
      }
    })

    setSummaries(result)
    // 選択中の講師データを更新
    if (selectedTeacher) {
      setSelectedTeacher(result.find(s => s.id === selectedTeacher.id) ?? null)
    }
    setLoading(false)
  }

  const saveEdit = async () => {
    if (!edit) return
    setSaving(true)
    const data = buildInsertOrUpdate(edit)
    if (!data) { setSaving(false); return }
    await supabase.from('itoshima_attendances').update(data).eq('id', edit.id)
    setSaving(false)
    setEdit(null)
    fetchData()
  }

  const saveNew = async () => {
    if (!newRecord) return
    setSaving(true)
    const data = buildInsertOrUpdate(newRecord)
    if (!data) { setSaving(false); return }
    await supabase.from('itoshima_attendances').insert({ teacher_id: newRecord.teacherId, ...data })
    setSaving(false)
    setNewRecord(null)
    fetchData()
  }

  const handleDelete = async (recordId: string) => {
    if (!confirm('この記録を削除しますか？')) return
    // 即座にUIから削除
    setSelectedTeacher(prev => prev ? { ...prev, records: prev.records.filter(r => r.id !== recordId) } : null)
    setSummaries(prev => prev.map(s => ({ ...s, records: s.records.filter(r => r.id !== recordId) })))
    if (edit?.id === recordId) setEdit(null)
    // DBに反映・集計値を再同期
    await supabase.from('itoshima_attendances').delete().eq('id', recordId)
    fetchData()
  }

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  if (!teacher) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <header
        className="shadow-md"
        style={{ backgroundColor: ORANGE }}
      >
        <div className="flex items-center justify-between px-6 py-4 max-w-screen-xl mx-auto">
          <div>
            <p className="text-white/70 text-xs">糸島学習塾</p>
            <p className="text-white font-bold text-xl">管理画面</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/attendance" className="text-white/90 text-sm underline underline-offset-2">
              勤怠入力
            </Link>
            <button onClick={handleLogout} className="bg-white/20 text-white text-sm px-4 py-2 rounded-lg">
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* タブバー */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-screen-xl mx-auto px-6 flex gap-1 pt-2">
          {(['attendance', 'shift'] as const).map((tab) => {
            const label = tab === 'attendance' ? '勤怠管理' : '空き時間帯'
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-5 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition-colors"
                style={
                  activeTab === tab
                    ? { borderColor: ORANGE, color: ORANGE, backgroundColor: '#FFF7ED' }
                    : { borderColor: 'transparent', color: '#6b7280', backgroundColor: 'transparent' }
                }
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 flex flex-col gap-4">

        {/* ===== 勤怠管理タブ ===== */}
        {activeTab === 'attendance' && <>

        {/* 月選択 */}
        <div className="flex items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
          <span className="text-sm font-semibold text-gray-600">表示月</span>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => { setSelectedMonth(e.target.value); setSelectedTeacher(null); setEdit(null); setNewRecord(null) }}
            className="border-2 border-gray-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-[#FF7F00]"
          />
          <p className="ml-2 text-gray-400 text-sm">講師名をクリックすると詳細・編集できます</p>
        </div>

        {/* メインエリア */}
        <div className="flex gap-5 items-start">

          {/* 左：講師一覧 */}
          <div className="w-72 shrink-0 sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-2">
            {loading ? (
              <p className="text-center text-gray-400 py-10">読み込み中...</p>
            ) : (
              summaries.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedTeacher(s); setEdit(null); setNewRecord(null) }}
                  className="w-full text-left bg-white rounded-2xl shadow px-5 py-4 border-2 transition-all hover:shadow-md"
                  style={{
                    borderColor: selectedTeacher?.id === s.id ? ORANGE : 'transparent',
                    backgroundColor: selectedTeacher?.id === s.id ? '#FFF7ED' : 'white',
                  }}
                >
                  <p className="font-bold text-gray-800 text-base">{s.name}</p>
                  <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                    <p>個別 {s.individualPeriods}コマ　集団①② {s.groupPeriodsEarly}コマ</p>
                    <p>集団③以降 {s.groupPeriodsLate}コマ　勤務 {s.workingDays}日</p>
                    {s.extraMinutes > 0 && <p>追加業務 {fmtMin(s.extraMinutes)}</p>}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 右：詳細・編集 */}
          <div className="flex-1 min-w-0">
            {!selectedTeacher ? (
              <div className="bg-white rounded-2xl shadow p-16 text-center text-gray-400">
                <p className="text-lg">左の講師名を選択してください</p>
              </div>
            ) : (
              <div>
                {/* 講師ヘッダー */}
                <div className="bg-white rounded-2xl shadow px-6 py-4 mb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xl font-bold text-gray-800 mb-2">{selectedTeacher.name} 先生</p>
                      <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-sm text-gray-500">
                        <span>個別指導　<span className="font-bold text-gray-800">{selectedTeacher.individualPeriods}</span>コマ</span>
                        <span>集団①②　<span className="font-bold text-gray-800">{selectedTeacher.groupPeriodsEarly}</span>コマ</span>
                        <span>集団③以降　<span className="font-bold text-gray-800">{selectedTeacher.groupPeriodsLate}</span>コマ</span>
                        <span>勤務日数　<span className="font-bold text-gray-800">{selectedTeacher.workingDays}</span>日</span>
                        <span>追加業務　<span className="font-bold text-gray-800">{fmtMin(selectedTeacher.extraMinutes)}</span></span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setEdit(null); setNewRecord({ teacherId: selectedTeacher.id, date: todayStr(), lessonType: '個別指導', periods: 1, slots: [], extraMinutes: '0' }) }}
                      className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg border-2 whitespace-nowrap"
                      style={{ color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
                    >
                      ＋ 勤務を追加
                    </button>
                  </div>
                </div>

                {/* 新規追加フォーム */}
                {newRecord?.teacherId === selectedTeacher.id && (
                  <RecordForm
                    title="新規追加"
                    form={newRecord}
                    onChange={patch => setNewRecord(prev => prev ? { ...prev, ...patch } : prev)}
                    onSave={saveNew}
                    onCancel={() => setNewRecord(null)}
                    saving={saving}
                  />
                )}

                {/* 編集フォーム */}
                {edit && (
                  <RecordForm
                    title={`編集：${formatDate(edit.date)}`}
                    form={edit}
                    onChange={patch => setEdit(prev => prev ? { ...prev, ...patch } : prev)}
                    onSave={saveEdit}
                    onCancel={() => setEdit(null)}
                    saving={saving}
                  />
                )}

                {/* 記録テーブル */}
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  {selectedTeacher.records.length === 0 ? (
                    <p className="text-center text-gray-400 py-10">記録がありません</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100 bg-orange-50">
                          <th className="text-left px-5 py-3 text-sm font-bold text-gray-600">日付</th>
                          <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">種別</th>
                          <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">内容</th>
                          <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">コマ数</th>
                          <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">追加業務</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedTeacher.records.map(r => {
                          const isEditing = edit?.id === r.id
                          return (
                            <tr
                              key={r.id}
                              style={{ backgroundColor: isEditing ? '#FFF7ED' : undefined }}
                            >
                              <td className="px-5 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">
                                {formatDate(r.date)}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className="text-xs font-bold px-2.5 py-1 rounded-full"
                                  style={{ backgroundColor: '#FFF0E0', color: '#CC5500' }}
                                >
                                  {r.lesson_type}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                {r.lesson_type === '集団授業' && r.notes ? r.notes : '−'}
                              </td>
                              <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                                {r.periods}コマ
                              </td>
                              <td className="px-4 py-3 text-center text-sm text-gray-500">
                                {(r.extra_minutes ?? 0) > 0 ? fmtMin(r.extra_minutes ?? 0) : '−'}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => { setNewRecord(null); setEdit({ id: r.id, date: r.date, lessonType: r.lesson_type as '個別指導' | '集団授業', periods: r.periods, slots: r.notes ? r.notes.split('').filter(c => ['①','②','③','④','⑤'].includes(c)) : [], extraMinutes: String(r.extra_minutes ?? 0) }) }}
                                  className="text-xs px-3 py-1.5 rounded-lg border font-medium mr-2 hover:bg-gray-50"
                                  style={{ color: '#b08800', borderColor: '#F5C200' }}
                                >
                                  編集
                                </button>
                                <button
                                  onClick={() => handleDelete(r.id)}
                                  disabled={deletingId === r.id}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 disabled:opacity-40"
                                >
                                  {deletingId === r.id ? '削除中' : '削除'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 bg-orange-50">
                          <td colSpan={3} className="px-5 py-3 text-sm font-bold text-gray-700">月合計</td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                            {selectedTeacher.individualPeriods + selectedTeacher.groupPeriodsEarly + selectedTeacher.groupPeriodsLate}コマ
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                            {selectedTeacher.extraMinutes > 0 ? fmtMin(selectedTeacher.extraMinutes) : '−'}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        </> /* end 勤怠管理タブ */}

        {/* ===== シフト希望タブ ===== */}
        {activeTab === 'shift' && (() => {
          const [sYear, sMonth] = shiftMonth.split('-').map(Number)
          const lastDate = new Date(sYear, sMonth, 0).getDate()
          const dates: string[] = []
          for (let d = 1; d <= lastDate; d++) {
            dates.push(`${sYear}-${String(sMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
          }

          const prevShiftMonth = () => {
            const d = new Date(sYear, sMonth - 2, 1)
            setShiftMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }
          const nextShiftMonth = () => {
            const d = new Date(sYear, sMonth, 1)
            setShiftMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }

          return (
            <>
              {/* 月ナビ */}
              <div className="flex items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
                <button onClick={prevShiftMonth} className="text-2xl text-gray-400 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100">‹</button>
                <span className="text-base font-bold text-gray-800">{sYear}年{sMonth}月</span>
                <button onClick={nextShiftMonth} className="text-2xl text-gray-400 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100">›</button>
                <span className="ml-2 text-xs text-gray-400">講師がシフトを更新すると自動で反映されます</span>
              </div>

              {shiftLoading ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">読み込み中...</div>
              ) : shiftRows.length === 0 ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">
                  この月のシフト希望はまだありません
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-orange-50">
                        <th className="px-4 py-3 text-left font-bold text-gray-600 whitespace-nowrap">日付</th>
                        {SHIFT_SLOTS.map(s => (
                          <th key={s.slot} className="px-4 py-3 text-left font-bold text-gray-600 whitespace-nowrap">
                            {s.label}　{s.start}〜{s.end}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dates.map(date => {
                        const slot1rows = shiftRows.filter(r => r.date === date && r.slot === 1)
                        const slot2rows = shiftRows.filter(r => r.date === date && r.slot === 2)
                        if (slot1rows.length === 0 && slot2rows.length === 0) return null

                        const dow = new Date(date + 'T00:00:00').getDay()
                        const dayLabel = '日月火水木金土'[dow]
                        const dateStr = `${sMonth}/${parseInt(date.split('-')[2])}（${dayLabel}）`

                        return (
                          <tr key={date} style={{ backgroundColor: dow === 0 ? '#FFF5F5' : dow === 6 ? '#F5F8FF' : undefined }}>
                            <td
                              className="px-4 py-3 font-medium whitespace-nowrap"
                              style={{ color: dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#374151' }}
                            >
                              {dateStr}
                            </td>
                            {SHIFT_SLOTS.map(s => {
                              const rows = s.slot === 1 ? slot1rows : slot2rows
                              return (
                                <td key={s.slot} className="px-4 py-3">
                                  {rows.length === 0 ? (
                                    <span className="text-gray-300">−</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {rows.map(r => (
                                        <span
                                          key={r.teacher_id}
                                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                                          style={{ backgroundColor: '#FFF0E0', color: '#CC5500' }}
                                        >
                                          {r.teacher_name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        })()}

      </div>
    </div>
  )
}
