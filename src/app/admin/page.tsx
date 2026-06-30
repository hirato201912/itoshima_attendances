'use client'

import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { GROUP_SLOTS, SHIFT_SLOTS, SUMMER_SLOTS, SUMMER_PERIOD, SUMMER_APPLY_PERIOD } from '@/types'
import type { Attendance, LoggedInTeacher } from '@/types'

const MAIN_SLOTS = new Set<number>([2, 3])
const isMainSlot = (slot: number) => MAIN_SLOTS.has(slot)

type SummerApplyRow = {
  id: string
  student_name: string
  grade: string | null
  course: string | null
  notes: string | null
  created_at: string
}
type SummerApplySlotRow = {
  apply_id: string
  date: string
  slot: number
  is_confirmed: boolean
  assigned_teacher_id: string | null
  subject: string | null
  // false=保護者が申し込んだコマ / true=管理者が後から追加したコマ
  added_by_admin: boolean
}

// 科目はコード内固定（DBには値のみ保存／表示ラベルだけ別管理）
// 「数学」は小学生の「算数」も兼ねるため、表示は「数学/算数」とする
const SUBJECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '数学', label: '数学/算数' },
  { value: '英語', label: '英語' },
  { value: '国語', label: '国語' },
  { value: '理科', label: '理科' },
  { value: '社会', label: '社会' },
  { value: 'その他', label: 'その他' },
]
const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(SUBJECT_OPTIONS.map(o => [o.value, o.label]))

const ORANGE = '#FF7F00'

const LESSON_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  '個別指導': { dot: '#FF7F00', bg: '#FFF0E0', text: '#CC5500' },
  '集団授業': { dot: '#3B82F6', bg: '#DBEAFE', text: '#1E40AF' },
}

type DayRecord = Attendance & { teacher: { id: string; name: string; code: number } }

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
  individualPeriods: number   // 0=個別なし, 1-5
  groupSlots: string[]        // 集団授業の時間帯ラベル
  extraMinutes: string
}

type EditState = FormState & {
  teacherId: string
  originalDate: string
  individualId: string | null
  groupId: string | null
}
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

// 1日分のフォーム→ 個別／集団 のレコード(または null=作らない/削除)を組み立てる
// 勤怠入力画面のロジック（hasIndividual ? 個別にextra : 集団にextra）と整合させる
function buildDayPayloads(form: FormState): {
  individual: Record<string, unknown> | null
  group: Record<string, unknown> | null
  allEmpty: boolean
} {
  const extra = parseInt(form.extraMinutes) || 0
  const hasIndividual = form.individualPeriods > 0
  const hasGroup = form.groupSlots.length > 0
  const allEmpty = !hasIndividual && !hasGroup && extra === 0

  let individual: Record<string, unknown> | null = null
  let group: Record<string, unknown> | null = null

  // 個別指導：コマ数>0 OR （集団なし＋追加業務>0）
  if (hasIndividual || (!hasGroup && extra > 0)) {
    individual = {
      date: form.date,
      lesson_type: '個別指導',
      periods: form.individualPeriods,
      start_time: null,
      end_time: null,
      extra_minutes: extra,
      notes: null,
    }
  }

  // 集団授業：時間帯>=1個
  if (hasGroup) {
    const sorted = [...form.groupSlots].sort()
    const first = GROUP_SLOTS.find(s => s.label === sorted[0])!
    const last  = GROUP_SLOTS.find(s => s.label === sorted[sorted.length - 1])!
    group = {
      date: form.date,
      lesson_type: '集団授業',
      periods: form.groupSlots.length,
      start_time: first.start,
      end_time: last.end,
      // 個別がある日は extra は個別側に集約、ない日は集団側に
      extra_minutes: hasIndividual ? 0 : extra,
      notes: sorted.join(''),
    }
  }

  return { individual, group, allEmpty }
}

// 1日分の編集・新規共通フォーム（個別・集団 両セクションを同時に表示）
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
    const groupSlots = form.groupSlots.includes(label)
      ? form.groupSlots.filter(s => s !== label)
      : [...form.groupSlots, label]
    onChange({ groupSlots })
  }

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-4">
      <p className="text-sm font-bold text-orange-700 mb-4">{title}</p>

      {/* 上段：日付・追加業務時間 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
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
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            追加業務時間（分）<span className="text-gray-400 font-normal ml-1">この日全体</span>
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={form.extraMinutes}
            onChange={e => onChange({ extraMinutes: e.target.value })}
            className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-[#FF7F00]"
          />
        </div>
      </div>

      {/* 中段：個別 / 集団 を横並び */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* 個別指導 */}
        <div className="bg-white rounded-lg border border-orange-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#FF7F00' }}>個別指導</span>
            <span className="text-xs text-gray-500">コマ数</span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {[0, 1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ individualPeriods: n })}
                className="py-2 rounded-lg text-sm font-bold border-2 transition-colors"
                style={
                  form.individualPeriods === n
                    ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                    : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                }
              >
                {n === 0 ? 'なし' : n}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">個別がない日は「なし」を選択</p>
        </div>

        {/* 集団授業 */}
        <div className="bg-white rounded-lg border border-orange-100 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#3B82F6' }}>集団授業</span>
            <span className="text-xs text-gray-500">時間帯（複数選択可）</span>
          </div>
          <div className="space-y-1.5">
            {GROUP_SLOTS.map(slot => {
              const isSelected = form.groupSlots.includes(slot.label)
              return (
                <button
                  key={slot.label}
                  type="button"
                  onClick={() => toggleSlot(slot.label)}
                  className="w-full px-3 py-1.5 rounded-lg text-xs border-2 text-left transition-colors"
                  style={
                    isSelected
                      ? { backgroundColor: '#3B82F6', borderColor: '#3B82F6', color: 'white' }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                  }
                >
                  {slot.label}　{slot.start} 〜 {slot.end}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 下段：保存・キャンセル */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={saving}
          className="flex-1 py-2.5 rounded-lg text-sm text-gray-500 border border-gray-300 bg-white"
        >
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 py-2.5 rounded-lg text-white text-sm font-bold disabled:opacity-60"
          style={{ backgroundColor: ORANGE }}
        >
          {saving ? '保存中...' : '保存する'}
        </button>
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
  const [activeTab, setActiveTab] = useState<'attendance' | 'shift' | 'summer' | 'apply'>('attendance')

  // 勤怠タブ
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [summaries, setSummaries] = useState<TeacherSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherSummary | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [newRecord, setNewRecord] = useState<NewState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'teacher' | 'day'>('teacher')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const dayDetailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedDate && dayDetailRef.current) {
      requestAnimationFrame(() => {
        dayDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [selectedDate])

  const closeDetailAndScrollUp = () => {
    calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setSelectedDate(null)
  }

  // シフトタブ
  const [shiftMonth, setShiftMonth] = useState(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [shiftRows, setShiftRows] = useState<ShiftRow[]>([])
  const [shiftLoading, setShiftLoading] = useState(false)

  // 夏期講習タブ
  const [summerTeachers, setSummerTeachers] = useState<{ id: string; name: string; code: number }[]>([])
  const [summerRows, setSummerRows] = useState<{ teacher_id: string; date: string; slot: number; confirmed_count: number }[]>([])
  const [summerLoading, setSummerLoading] = useState(false)
  const [expandedSummerTeacher, setExpandedSummerTeacher] = useState<string | null>(null)
  const [togglingConfirmKey, setTogglingConfirmKey] = useState<string | null>(null)

  // 申込一覧タブ（保護者からの夏期講習申込）
  const [applyRows, setApplyRows] = useState<SummerApplyRow[]>([])
  const [applySlots, setApplySlots] = useState<SummerApplySlotRow[]>([])
  const [applyLoading, setApplyLoading] = useState(false)
  const [expandedApplyId, setExpandedApplyId] = useState<string | null>(null)
  const [deletingApplyId, setDeletingApplyId] = useState<string | null>(null)
  const [togglingApplyConfirmKey, setTogglingApplyConfirmKey] = useState<string | null>(null)
  // 管理者追加コマ用ピッカーの一時 state
  const [adminAddDate, setAdminAddDate] = useState('')
  const [adminAddSlot, setAdminAddSlot] = useState('')
  const [addingAdminSlot, setAddingAdminSlot] = useState(false)
  const [bulkDeletingApply, setBulkDeletingApply] = useState(false)
  // 全件削除のブロック用：CSVを今セッションでダウンロードしたか、確認モーダル開閉、入力テキスト一致
  const [csvDownloadedThisSession, setCsvDownloadedThisSession] = useState(false)
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState('')

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

  // 夏期講習データ取得＋リアルタイム購読
  useEffect(() => {
    if (!teacher) return

    const fetchSummer = async () => {
      setSummerLoading(true)
      const [{ data: teachers }, { data: rows }] = await Promise.all([
        supabase
          .from('itoshima_teachers')
          .select('id, name, code')
          .eq('is_admin', false)
          .eq('is_juku_teacher', true)
          .order('code'),
        supabase
          .from('juku_summer_availability')
          .select('teacher_id, date, slot, confirmed_count')
          .gte('date', SUMMER_PERIOD.start)
          .lte('date', SUMMER_PERIOD.end),
      ])
      setSummerTeachers(teachers ?? [])
      setSummerRows((rows ?? []) as { teacher_id: string; date: string; slot: number; confirmed_count: number }[])
      setSummerLoading(false)
    }

    fetchSummer()

    const channel = supabase
      .channel('summer-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'juku_summer_availability' },
        () => { fetchSummer() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [teacher])

  // 展開する申込を切り替えたら「管理者追加」ピッカーをリセット
  useEffect(() => {
    setAdminAddDate('')
    setAdminAddSlot('')
  }, [expandedApplyId])

  // 保護者からの夏期講習申込データ取得＋リアルタイム購読
  useEffect(() => {
    if (!teacher) return

    const fetchApply = async () => {
      setApplyLoading(true)
      const [{ data: applies }, { data: slots }] = await Promise.all([
        supabase
          .from('juku_summer_apply')
          .select('id, student_name, grade, course, notes, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('juku_summer_apply_slots')
          .select('apply_id, date, slot, is_confirmed, assigned_teacher_id, subject, added_by_admin'),
      ])
      setApplyRows((applies ?? []) as SummerApplyRow[])
      setApplySlots((slots ?? []) as SummerApplySlotRow[])
      setApplyLoading(false)
      // データが更新された＝持っているCSVは古い可能性、再ダウンロードを必須にする
      setCsvDownloadedThisSession(false)
    }

    fetchApply()

    const channel = supabase
      .channel('apply-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'juku_summer_apply' }, () => { fetchApply() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'juku_summer_apply_slots' }, () => { fetchApply() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [teacher])

  const recordsByDate = useMemo(() => {
    const map = new Map<string, DayRecord[]>()
    for (const s of summaries) {
      for (const r of s.records) {
        const list = map.get(r.date) ?? []
        list.push({ ...r, teacher: { id: s.id, name: s.name, code: s.code } })
        map.set(r.date, list)
      }
    }
    return map
  }, [summaries])

  const calendarCells = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const firstDow = new Date(y, m - 1, 1).getDay()
    const daysInMonth = new Date(y, m, 0).getDate()
    const totalRows = Math.ceil((firstDow + daysInMonth) / 7)
    const total = totalRows * 7
    const mm = String(m).padStart(2, '0')
    const cells: Array<null | { dateStr: string; day: number; dow: number; records: DayRecord[] }> = []
    for (let i = 0; i < total; i++) {
      const dayNum = i - firstDow + 1
      if (dayNum < 1 || dayNum > daysInMonth) {
        cells.push(null)
      } else {
        const dateStr = `${y}-${mm}-${String(dayNum).padStart(2, '0')}`
        const records = recordsByDate.get(dateStr) ?? []
        cells.push({ dateStr, day: dayNum, dow: (firstDow + dayNum - 1) % 7, records })
      }
    }
    return cells
  }, [selectedMonth, recordsByDate])

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

  // 1日分のフォーム→ 個別／集団 のレコードを更新／追加／削除
  const persistDayForm = async (form: FormState, teacherId: string, originalIndividualId: string | null, originalGroupId: string | null) => {
    const { individual, group, allEmpty } = buildDayPayloads(form)
    if (allEmpty && !originalIndividualId && !originalGroupId) {
      return { ok: false as const, reason: 'empty' as const }
    }
    // 個別指導
    if (individual) {
      if (originalIndividualId) {
        await supabase.from('itoshima_attendances').update(individual).eq('id', originalIndividualId)
      } else {
        await supabase.from('itoshima_attendances').insert({ teacher_id: teacherId, ...individual })
      }
    } else if (originalIndividualId) {
      await supabase.from('itoshima_attendances').delete().eq('id', originalIndividualId)
    }
    // 集団授業
    if (group) {
      if (originalGroupId) {
        await supabase.from('itoshima_attendances').update(group).eq('id', originalGroupId)
      } else {
        await supabase.from('itoshima_attendances').insert({ teacher_id: teacherId, ...group })
      }
    } else if (originalGroupId) {
      await supabase.from('itoshima_attendances').delete().eq('id', originalGroupId)
    }
    return { ok: true as const }
  }

  const saveEdit = async () => {
    if (!edit) return
    setFormError(null)
    setSaving(true)
    const result = await persistDayForm(edit, edit.teacherId, edit.individualId, edit.groupId)
    if (!result.ok) {
      setFormError('コマ数・時間帯・追加業務時間のいずれかを入力してください。')
      setSaving(false)
      return
    }
    setSaving(false)
    setEdit(null)
    fetchData()
  }

  const saveNew = async () => {
    if (!newRecord) return
    setFormError(null)
    setSaving(true)
    // 新規追加：その日に同じ先生のレコードが既にあれば、それを既存IDとして扱う（重複を避けて編集モード相当の動きに）
    const { data: existingList } = await supabase
      .from('itoshima_attendances')
      .select('id, lesson_type')
      .eq('teacher_id', newRecord.teacherId)
      .eq('date', newRecord.date)
    const existingIndividualId = (existingList ?? []).find(r => r.lesson_type === '個別指導')?.id ?? null
    const existingGroupId = (existingList ?? []).find(r => r.lesson_type === '集団授業')?.id ?? null

    const result = await persistDayForm(newRecord, newRecord.teacherId, existingIndividualId, existingGroupId)
    if (!result.ok) {
      setFormError('コマ数・時間帯・追加業務時間のいずれかを入力してください。')
      setSaving(false)
      return
    }
    setSaving(false)
    setNewRecord(null)
    fetchData()
  }

  const handleDelete = async (recordId: string) => {
    if (!confirm('この記録を削除しますか？')) return
    // 即座にUIから削除
    setSelectedTeacher(prev => prev ? { ...prev, records: prev.records.filter(r => r.id !== recordId) } : null)
    setSummaries(prev => prev.map(s => ({ ...s, records: s.records.filter(r => r.id !== recordId) })))
    if (edit?.individualId === recordId || edit?.groupId === recordId) setEdit(null)
    // DBに反映・集計値を再同期
    await supabase.from('itoshima_attendances').delete().eq('id', recordId)
    fetchData()
  }

  // 1日分（個別＋集団 両方）まとめて削除
  const handleDeleteDay = async (individualId: string | null, groupId: string | null, dateStr: string) => {
    const ids = [individualId, groupId].filter((x): x is string => !!x)
    if (ids.length === 0) return
    if (!confirm(`${formatDate(dateStr)} の記録（${ids.length}件）を削除しますか？`)) return
    setDeletingId(ids[0])
    setSelectedTeacher(prev => prev ? { ...prev, records: prev.records.filter(r => !ids.includes(r.id)) } : null)
    setSummaries(prev => prev.map(s => ({ ...s, records: s.records.filter(r => !ids.includes(r.id)) })))
    if (edit?.originalDate === dateStr) setEdit(null)
    await supabase.from('itoshima_attendances').delete().in('id', ids)
    setDeletingId(null)
    fetchData()
  }

  // 今月の全講師レコードを CSV ダウンロード（画面表示と同じ：1行=1日分）
  const downloadMonthCsv = () => {
    const headers = ['講師コード', '講師名', '日付', '個別指導', '集団授業', '追加業務']
    type Row = { code: number; name: string; date: string; individual: string; group: string; extra: string }
    const rows: Row[] = []
    for (const t of summaries) {
      // 日付ごとに個別・集団をまとめる
      const dateMap = new Map<string, { individual?: Attendance; group?: Attendance }>()
      for (const r of t.records) {
        const cur = dateMap.get(r.date) ?? {}
        if (r.lesson_type === '個別指導') cur.individual = r
        else if (r.lesson_type === '集団授業') cur.group = r
        dateMap.set(r.date, cur)
      }
      for (const [date, day] of dateMap) {
        const totalExtra = (day.individual?.extra_minutes ?? 0) + (day.group?.extra_minutes ?? 0)
        rows.push({
          code: t.code,
          name: t.name,
          date,
          individual: day.individual ? `${day.individual.periods}コマ` : '−',
          group: day.group?.notes ? day.group.notes : '−',
          extra: totalExtra > 0 ? fmtMin(totalExtra) : '−',
        })
      }
    }
    rows.sort((a, b) => a.code - b.code || a.date.localeCompare(b.date))
    const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const body = rows.map(r => [String(r.code), r.name, formatDate(r.date), r.individual, r.group, r.extra])
    const csv = [headers, ...body].map(row => row.map(escape).join(',')).join('\r\n')
    // Excel が UTF-8 として正しく開けるよう BOM を先頭に付与
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `juku-attendance-${selectedMonth}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 夏期講習：講師×日付×コマの確定状況を 希望(0) → 1人(1) → 2人(2) → 希望(0) でサイクル
  const cycleSummerConfirm = async (teacherId: string, date: string, slot: number, current: number) => {
    const key = `${teacherId}_${date}_${slot}`
    if (togglingConfirmKey) return
    setTogglingConfirmKey(key)
    const next = (current + 1) % 3
    // 楽観的更新
    setSummerRows(prev => prev.map(r =>
      r.teacher_id === teacherId && r.date === date && r.slot === slot
        ? { ...r, confirmed_count: next }
        : r
    ))
    await supabase
      .from('juku_summer_availability')
      .update({ confirmed_count: next })
      .eq('teacher_id', teacherId)
      .eq('date', date)
      .eq('slot', slot)
    setTogglingConfirmKey(null)
  }

  // 保護者申込：1コマの確定状態をトグル
  const toggleApplyConfirm = async (applyId: string, date: string, slot: number, current: boolean) => {
    const key = `${applyId}_${date}_${slot}`
    if (togglingApplyConfirmKey) return
    setTogglingApplyConfirmKey(key)
    // 楽観的更新
    setApplySlots(prev => prev.map(s =>
      s.apply_id === applyId && s.date === date && s.slot === slot
        ? { ...s, is_confirmed: !current }
        : s
    ))
    await supabase
      .from('juku_summer_apply_slots')
      .update({ is_confirmed: !current })
      .eq('apply_id', applyId)
      .eq('date', date)
      .eq('slot', slot)
    setTogglingApplyConfirmKey(null)
  }

  // 保護者申込：1コマに担当講師を割り当て（''=未割当=null）
  const setApplyAssignment = async (applyId: string, date: string, slot: number, teacherId: string | null) => {
    // 楽観的更新
    setApplySlots(prev => prev.map(s =>
      s.apply_id === applyId && s.date === date && s.slot === slot
        ? { ...s, assigned_teacher_id: teacherId }
        : s
    ))
    await supabase
      .from('juku_summer_apply_slots')
      .update({ assigned_teacher_id: teacherId })
      .eq('apply_id', applyId)
      .eq('date', date)
      .eq('slot', slot)
  }

  // 保護者申込：1コマに受講科目を割り当て（''=未指定=null）
  const setApplySubject = async (applyId: string, date: string, slot: number, subject: string | null) => {
    setApplySlots(prev => prev.map(s =>
      s.apply_id === applyId && s.date === date && s.slot === slot
        ? { ...s, subject }
        : s
    ))
    await supabase
      .from('juku_summer_apply_slots')
      .update({ subject })
      .eq('apply_id', applyId)
      .eq('date', date)
      .eq('slot', slot)
  }

  // 申込フォームと同じ仕様の有効日付一覧（土日・お盆休みを除外）
  const summerApplyDates = useMemo(() => {
    const out: string[] = []
    const start = new Date(SUMMER_APPLY_PERIOD.start + 'T00:00:00')
    const end = new Date(SUMMER_APPLY_PERIOD.end + 'T00:00:00')
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (dow === 0 || dow === 6) continue
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const ds = `${y}-${m}-${day}`
      const inClosed = SUMMER_APPLY_PERIOD.closedRanges.find(r => ds >= r.start && ds <= r.end)
      if (inClosed) continue
      out.push(ds)
    }
    return out
  }, [])

  // 管理者追加：1コマを追加（保護者と合意済みの前提で運用）
  const addAdminApplySlot = async (applyId: string, date: string, slot: number) => {
    // 重複ガード（保護者・管理者どちらが既に登録していても二重追加させない）
    const exists = applySlots.some(s => s.apply_id === applyId && s.date === date && s.slot === slot)
    if (exists) {
      alert('このコマは既に登録されています')
      return
    }
    setAddingAdminSlot(true)
    // 楽観的更新
    const newRow: SummerApplySlotRow = {
      apply_id: applyId,
      date,
      slot,
      is_confirmed: false,
      assigned_teacher_id: null,
      subject: null,
      added_by_admin: true,
    }
    setApplySlots(prev => [...prev, newRow])
    const { error } = await supabase
      .from('juku_summer_apply_slots')
      .insert({ apply_id: applyId, date, slot, added_by_admin: true })
    if (error) {
      // ロールバック
      setApplySlots(prev => prev.filter(s => !(s.apply_id === applyId && s.date === date && s.slot === slot)))
      alert('追加に失敗しました：' + error.message)
    }
    setAddingAdminSlot(false)
  }

  // 管理者追加：1コマを削除（保護者申込分は守る・二重ガード：UI＋DB条件）
  const removeAdminApplySlot = async (applyId: string, date: string, slot: number) => {
    const target = applySlots.find(s => s.apply_id === applyId && s.date === date && s.slot === slot)
    if (!target || !target.added_by_admin) return
    if (!confirm('この管理者追加コマを削除しますか？\n（保護者から申し込まれたコマは削除できません）')) return
    // 楽観的削除
    setApplySlots(prev => prev.filter(s => !(s.apply_id === applyId && s.date === date && s.slot === slot)))
    await supabase
      .from('juku_summer_apply_slots')
      .delete()
      .eq('apply_id', applyId)
      .eq('date', date)
      .eq('slot', slot)
      .eq('added_by_admin', true) // DB側でも：保護者分は誤って消えない
  }

  // 全件削除モーダルを開く（CSVダウンロード済みのときだけ押せる）
  const openBulkDeleteModal = () => {
    if (applyRows.length === 0 || !csvDownloadedThisSession) return
    setBulkDeleteConfirmText('')
    setBulkDeleteModalOpen(true)
  }

  // 全件削除モーダル内：「削除します」と一致したら実行
  const executeBulkDeleteApply = async () => {
    if (bulkDeleteConfirmText !== '削除します') return
    if (applyRows.length === 0) return
    setBulkDeletingApply(true)
    // 全件削除：created_at は必ず存在するためフィルタとして利用
    await supabase.from('juku_summer_apply').delete().gte('created_at', '1900-01-01')
    setApplyRows([])
    setApplySlots([])
    setExpandedApplyId(null)
    setCsvDownloadedThisSession(false)
    setBulkDeletingApply(false)
    setBulkDeleteModalOpen(false)
    setBulkDeleteConfirmText('')
  }

  // 申込を削除（CASCADEで slots も消える）
  const handleDeleteApply = async (applyId: string, studentName: string) => {
    if (!confirm(`「${studentName}」さんの申込を削除しますか？\n（希望コマも含めてすべて削除されます）`)) return
    setDeletingApplyId(applyId)
    setApplyRows(prev => prev.filter(r => r.id !== applyId))
    setApplySlots(prev => prev.filter(s => s.apply_id !== applyId))
    if (expandedApplyId === applyId) setExpandedApplyId(null)
    await supabase.from('juku_summer_apply').delete().eq('id', applyId)
    setDeletingApplyId(null)
  }

  // 講師1人分の夏期講習シフトをCSVダウンロード（紙配布用）
  const downloadSingleSummerCsv = (teacherInfo: { id: string; name: string; code: number }) => {
    const headers = ['講師', '日付', '曜日', 'コマ', '時間帯', '状態']
    const rows = summerRows
      .filter(r => r.teacher_id === teacherInfo.id)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
    const slotInfoMap: Record<number, { label: string; start: string; end: string }> = {}
    for (const s of SUMMER_SLOTS) slotInfoMap[s.slot] = { label: s.label, start: s.start, end: s.end }
    const body: string[][] = []
    if (rows.length === 0) {
      body.push([teacherInfo.name, '', '', '', '', '希望コマなし'])
    } else {
      rows.forEach((r, idx) => {
        const [, mm, dd] = r.date.split('-').map(Number)
        const dow = '日月火水木金土'[new Date(r.date + 'T00:00:00').getDay()]
        const info = slotInfoMap[r.slot]
        body.push([
          idx === 0 ? teacherInfo.name : '',
          `${mm}/${dd}`,
          dow,
          info.label,
          `${info.start}〜${info.end}`,
          r.confirmed_count === 2 ? '2人' : r.confirmed_count === 1 ? '1人' : '希望',
        ])
      })
    }
    const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const csv = [headers, ...body].map(row => row.map(escape).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = teacherInfo.name.replace(/[\\/:*?"<>|]/g, '_')
    a.download = `juku-summer-shift-${safeName}-${todayStr()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 申込1件分のCSVダウンロード（紙配布用：日付ごとに1行）
  const downloadSingleApplyCsv = (apply: SummerApplyRow) => {
    const headers = ['お子さんの名前', '学年', '希望コース', '申込日時', '日付', '曜日', 'コマ', '時間帯', 'メイン/予備', '状態', '追加元', '担当講師', '科目', '要望']
    const teacherNameById = new Map<string, string>()
    for (const t of summerTeachers) teacherNameById.set(t.id, t.name)
    const fmtDateTime = (iso: string) => {
      const d = new Date(iso)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return `${y}/${m}/${day} ${hh}:${mm}`
    }
    const slots = applySlots
      .filter(s => s.apply_id === apply.id)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
    const slotInfoMap: Record<number, { label: string; start: string; end: string }> = {}
    for (const s of SUMMER_SLOTS) slotInfoMap[s.slot] = { label: s.label, start: s.start, end: s.end }
    const createdAt = fmtDateTime(apply.created_at)
    const notesText = apply.notes ?? ''

    const courseText = apply.course ?? ''
    const body: string[][] = []
    if (slots.length === 0) {
      body.push([apply.student_name, apply.grade ?? '', courseText, createdAt, '', '', '', '', '', '', '', '', '', notesText])
    } else {
      slots.forEach((s, idx) => {
        const [, mm, dd] = s.date.split('-').map(Number)
        const dow = '日月火水木金土'[new Date(s.date + 'T00:00:00').getDay()]
        const info = slotInfoMap[s.slot]
        const tag = isMainSlot(s.slot) ? 'メイン' : '予備'
        const teacherName = s.assigned_teacher_id ? (teacherNameById.get(s.assigned_teacher_id) ?? '') : ''
        const subjectLabel = s.subject ? (SUBJECT_LABEL[s.subject] ?? s.subject) : ''
        const sourceLabel = s.added_by_admin ? '管理者' : '保護者'
        body.push([
          idx === 0 ? apply.student_name : '',
          idx === 0 ? (apply.grade ?? '') : '',
          idx === 0 ? courseText : '',
          idx === 0 ? createdAt : '',
          `${mm}/${dd}`,
          dow,
          info.label,
          `${info.start}〜${info.end}`,
          tag,
          s.is_confirmed ? '確定' : '希望',
          sourceLabel,
          teacherName,
          subjectLabel,
          idx === 0 ? notesText : '',
        ])
      })
    }
    const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const csv = [headers, ...body].map(row => row.map(escape).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = apply.student_name.replace(/[\\/:*?"<>|]/g, '_')
    a.download = `juku-summer-apply-${safeName}-${todayStr()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 申込一覧をCSVダウンロード
  const downloadApplyCsv = () => {
    const headers = [
      '申込日時', 'お子さんの名前', '学年', '希望コース',
      'メインコマ数', '予備コマ数', '合計コマ数', '確定コマ数', '担当未割当コマ数', '科目未指定コマ数', '管理者追加コマ数',
      '希望コマ一覧', '担当割当一覧', '科目割当一覧', '要望',
    ]
    const teacherNameById = new Map<string, string>()
    for (const t of summerTeachers) teacherNameById.set(t.id, t.name)
    const slotsByApply = new Map<string, SummerApplySlotRow[]>()
    for (const s of applySlots) {
      const list = slotsByApply.get(s.apply_id) ?? []
      list.push(s)
      slotsByApply.set(s.apply_id, list)
    }
    const fmtDateTime = (iso: string) => {
      const d = new Date(iso)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return `${y}/${m}/${day} ${hh}:${mm}`
    }
    const slotLabelOf = (n: number) => SUMMER_SLOTS.find(s => s.slot === n)?.label ?? `${n}`
    const body = applyRows.map(r => {
      const slots = (slotsByApply.get(r.id) ?? []).slice().sort((a, b) =>
        a.date.localeCompare(b.date) || a.slot - b.slot
      )
      const mainCount = slots.filter(s => isMainSlot(s.slot)).length
      const reserveCount = slots.length - mainCount
      const confirmedSlots = slots.filter(s => s.is_confirmed)
      const confirmedCount = confirmedSlots.length
      const unassignedCount = confirmedSlots.filter(s => !s.assigned_teacher_id).length
      const noSubjectCount = confirmedSlots.filter(s => !s.subject).length
      const adminAddedCount = slots.filter(s => s.added_by_admin).length
      const slotsLabel = slots.map(s => {
        const [, mm, dd] = s.date.split('-').map(Number)
        const tag = isMainSlot(s.slot) ? 'メイン' : '予備'
        const confMark = s.is_confirmed ? '★' : ''
        const adminMark = s.added_by_admin ? '＋' : ''
        return `${confMark}${adminMark}${mm}/${dd} ${slotLabelOf(s.slot)}(${tag})`
      }).join(' / ')
      const assignLabel = confirmedSlots.map(s => {
        const [, mm, dd] = s.date.split('-').map(Number)
        const tname = s.assigned_teacher_id ? (teacherNameById.get(s.assigned_teacher_id) ?? '不明') : '未割当'
        return `${mm}/${dd} ${slotLabelOf(s.slot)} → ${tname}`
      }).join(' / ')
      const subjectLabel = confirmedSlots.map(s => {
        const [, mm, dd] = s.date.split('-').map(Number)
        const sub = s.subject ? (SUBJECT_LABEL[s.subject] ?? s.subject) : '未指定'
        return `${mm}/${dd} ${slotLabelOf(s.slot)} → ${sub}`
      }).join(' / ')
      return [
        fmtDateTime(r.created_at),
        r.student_name,
        r.grade ?? '',
        r.course ?? '',
        String(mainCount),
        String(reserveCount),
        String(slots.length),
        String(confirmedCount),
        String(unassignedCount),
        String(noSubjectCount),
        String(adminAddedCount),
        slotsLabel,
        assignLabel,
        subjectLabel,
        r.notes ?? '',
      ]
    })
    const escape = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    const csv = [headers, ...body].map(row => row.map(escape).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const today = todayStr()
    a.download = `juku-summer-apply-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setCsvDownloadedThisSession(true)
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
          {(['attendance', 'shift', 'summer', 'apply'] as const).map((tab) => {
            const label = tab === 'attendance' ? '勤怠管理'
              : tab === 'shift' ? '空き時間帯'
              : tab === 'summer' ? '夏期講習'
              : '申込一覧'
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

        {/* ビュー切替＋月選択 */}
        <div className="flex items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setViewMode('teacher')}
              className="px-5 py-2 rounded-lg text-sm font-bold transition-colors"
              style={viewMode === 'teacher'
                ? { backgroundColor: '#fff', color: '#1f2937', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#6b7280' }
              }
            >
              講師別
            </button>
            <button
              onClick={() => setViewMode('day')}
              className="px-5 py-2 rounded-lg text-sm font-bold transition-colors"
              style={viewMode === 'day'
                ? { backgroundColor: '#fff', color: '#1f2937', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#6b7280' }
              }
            >
              日別
            </button>
          </div>
          <div className="flex-1" />
          <button
            onClick={downloadMonthCsv}
            disabled={loading || summaries.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-bold disabled:opacity-40"
            style={{ borderColor: ORANGE, color: ORANGE, backgroundColor: '#FFF7ED' }}
          >
            📥 今月のCSV
          </button>
          <span className="text-sm font-semibold text-gray-600">表示月</span>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => { setSelectedMonth(e.target.value); setSelectedTeacher(null); setEdit(null); setNewRecord(null); setSelectedDate(null) }}
            className="border-2 border-gray-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:border-[#FF7F00]"
          />
        </div>

        {/* 講師別ビュー：左リスト＋右詳細 */}
        {viewMode === 'teacher' && (
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
                      onClick={() => { setEdit(null); setFormError(null); setNewRecord({ teacherId: selectedTeacher.id, date: todayStr(), individualPeriods: 1, groupSlots: [], extraMinutes: '0' }) }}
                      className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg border-2 whitespace-nowrap"
                      style={{ color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
                    >
                      ＋ 勤務を追加
                    </button>
                  </div>
                </div>

                {/* 入力エラーバナー */}
                {formError && (edit || newRecord) && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 flex items-start justify-between gap-4">
                    <span className="text-red-600 text-sm font-medium">{formError}</span>
                    <button
                      onClick={() => setFormError(null)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium underline whitespace-nowrap"
                    >
                      閉じる
                    </button>
                  </div>
                )}

                {/* 新規追加フォーム */}
                {newRecord?.teacherId === selectedTeacher.id && (
                  <RecordForm
                    title="新規追加"
                    form={newRecord}
                    onChange={patch => { setFormError(null); setNewRecord(prev => prev ? { ...prev, ...patch } : prev) }}
                    onSave={saveNew}
                    onCancel={() => { setNewRecord(null); setFormError(null) }}
                    saving={saving}
                  />
                )}

                {/* 編集フォーム */}
                {edit && (
                  <RecordForm
                    title={`編集：${formatDate(edit.date)}`}
                    form={edit}
                    onChange={patch => { setFormError(null); setEdit(prev => prev ? { ...prev, ...patch } : prev) }}
                    onSave={saveEdit}
                    onCancel={() => { setEdit(null); setFormError(null) }}
                    saving={saving}
                  />
                )}

                {/* 記録テーブル（日付ごとに 個別／集団 を別カラムで表示） */}
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  {selectedTeacher.records.length === 0 ? (
                    <p className="text-center text-gray-400 py-10">記録がありません</p>
                  ) : (() => {
                    // 日付ごとに 個別・集団 をまとめる
                    const dateMap = new Map<string, { individual?: Attendance; group?: Attendance }>()
                    for (const r of selectedTeacher.records) {
                      const cur = dateMap.get(r.date) ?? {}
                      if (r.lesson_type === '個別指導') cur.individual = r
                      else if (r.lesson_type === '集団授業') cur.group = r
                      dateMap.set(r.date, cur)
                    }
                    const days = Array.from(dateMap.entries())
                      .map(([date, data]) => ({ date, ...data }))
                      .sort((a, b) => a.date.localeCompare(b.date))
                    return (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-100 bg-orange-50">
                            <th className="text-left px-5 py-3 text-sm font-bold text-gray-600">日付</th>
                            <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">個別指導</th>
                            <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">集団授業</th>
                            <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">追加業務</th>
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {days.map(day => {
                            const isEditing = edit?.originalDate === day.date
                            const totalExtra = (day.individual?.extra_minutes ?? 0) + (day.group?.extra_minutes ?? 0)
                            const isDeleting = (day.individual && deletingId === day.individual.id) || (day.group && deletingId === day.group.id)
                            return (
                              <tr
                                key={day.date}
                                style={{ backgroundColor: isEditing ? '#FFF7ED' : undefined }}
                              >
                                <td className="px-5 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">
                                  {formatDate(day.date)}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  {day.individual ? (
                                    <span
                                      className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                                      style={{ backgroundColor: '#FFF0E0', color: '#CC5500' }}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#FF7F00' }} />
                                      {day.individual.periods}コマ
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">−</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  {day.group ? (
                                    <span
                                      className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                                      style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#3B82F6' }} />
                                      {day.group.notes || ''}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">−</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center text-sm text-gray-600">
                                  {totalExtra > 0 ? fmtMin(totalExtra) : '−'}
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => {
                                      setNewRecord(null)
                                      setFormError(null)
                                      setEdit({
                                        teacherId: selectedTeacher.id,
                                        originalDate: day.date,
                                        individualId: day.individual?.id ?? null,
                                        groupId: day.group?.id ?? null,
                                        date: day.date,
                                        individualPeriods: day.individual?.periods ?? 0,
                                        groupSlots: day.group?.notes ? day.group.notes.split('').filter(c => ['①','②','③','④','⑤'].includes(c)) : [],
                                        extraMinutes: String(totalExtra),
                                      })
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg border font-medium mr-2 hover:bg-gray-50"
                                    style={{ color: '#b08800', borderColor: '#F5C200' }}
                                  >
                                    編集
                                  </button>
                                  <button
                                    onClick={() => handleDeleteDay(day.individual?.id ?? null, day.group?.id ?? null, day.date)}
                                    disabled={!!isDeleting}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 disabled:opacity-40"
                                  >
                                    {isDeleting ? '削除中' : '削除'}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 bg-orange-50">
                            <td className="px-5 py-3 text-sm font-bold text-gray-700">月合計</td>
                            <td className="px-4 py-3 text-sm font-bold text-gray-800">
                              個別 {selectedTeacher.individualPeriods}コマ
                            </td>
                            <td className="px-4 py-3 text-sm font-bold text-gray-800">
                              集団 {selectedTeacher.groupPeriodsEarly + selectedTeacher.groupPeriodsLate}コマ
                            </td>
                            <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                              {selectedTeacher.extraMinutes > 0 ? fmtMin(selectedTeacher.extraMinutes) : '−'}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* 日別ビュー：カレンダー＋下に詳細 */}
        {viewMode === 'day' && (
        <div className="space-y-4">
          {/* カレンダー */}
          <div ref={calendarRef} className="bg-white rounded-2xl shadow p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-10">
                <span
                  className="block w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                  style={{ borderTopColor: ORANGE }}
                />
                <span className="text-gray-500">読み込み中</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-7 mb-2">
                  {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                    <div
                      key={d}
                      className="text-center text-sm font-bold py-2"
                      style={{ color: i === 0 ? '#DC2626' : i === 6 ? '#2563EB' : '#6B7280' }}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarCells.map((cell, idx) => {
                    if (!cell) {
                      return <div key={`empty-${idx}`} className="aspect-square" />
                    }
                    const isSelected = selectedDate === cell.dateStr
                    const isToday = cell.dateStr === todayStr()
                    const hasRecords = cell.records.length > 0
                    const dayColor = cell.dow === 0 ? '#DC2626' : cell.dow === 6 ? '#2563EB' : '#374151'
                    const teacherCount = new Set(cell.records.map(r => r.teacher.id)).size
                    const bgColor = isSelected
                      ? '#FFF7ED'
                      : hasRecords ? '#FAFAF9' : 'white'
                    const borderColor = isSelected
                      ? ORANGE
                      : hasRecords ? '#D4D4D8' : '#E5E7EB'
                    return (
                      <button
                        key={cell.dateStr}
                        onClick={() => setSelectedDate(isSelected ? null : cell.dateStr)}
                        className="aspect-square rounded-xl border-2 p-2 transition-all flex flex-col text-left hover:shadow hover:border-gray-400"
                        style={{ borderColor, backgroundColor: bgColor }}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className="text-base font-bold" style={{ color: dayColor }}>
                            {cell.day}
                          </span>
                          {isToday && (
                            <span className="text-[10px] font-bold px-1 rounded text-white" style={{ backgroundColor: ORANGE }}>
                              今日
                            </span>
                          )}
                        </div>
                        {hasRecords && (
                          <>
                            <span className="text-sm font-bold text-gray-700 mt-1">{teacherCount}<span className="text-xs font-normal text-gray-500 ml-0.5">名</span></span>
                            <div className="mt-auto flex flex-wrap gap-0.5">
                              {cell.records.slice(0, 10).map((r) => {
                                const color = LESSON_COLORS[r.lesson_type] ?? { dot: '#9CA3AF', bg: '#F3F4F6', text: '#374151' }
                                return (
                                  <span
                                    key={r.id}
                                    className="block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: color.dot }}
                                  />
                                )
                              })}
                            </div>
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
                {/* 凡例 */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-3 items-center text-xs text-gray-500">
                  <span className="font-bold text-gray-400">凡例：</span>
                  {Object.entries(LESSON_COLORS).map(([name, color]) => (
                    <span key={name} className="inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.dot }} />
                      {name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 選択日の詳細 */}
          <div ref={dayDetailRef}>
          {selectedDate ? (() => {
            const dayRecords = (recordsByDate.get(selectedDate) ?? []).slice().sort((a, b) => {
              if (a.teacher.code !== b.teacher.code) return a.teacher.code - b.teacher.code
              return a.lesson_type.localeCompare(b.lesson_type)
            })
            const totalPeriods = dayRecords.reduce((s, r) => s + r.periods, 0)
            const totalExtra = dayRecords.reduce((s, r) => s + (r.extra_minutes ?? 0), 0)
            const teacherCount = new Set(dayRecords.map(r => r.teacher.id)).size
            return (
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-orange-50">
                  <div className="flex items-baseline gap-3 min-w-0">
                    <p className="text-lg font-bold text-gray-800 whitespace-nowrap">{formatDate(selectedDate)} の勤務</p>
                    {dayRecords.length > 0 && (
                      <p className="text-sm text-gray-500 whitespace-nowrap">{dayRecords.length}件 ／ {teacherCount}名</p>
                    )}
                  </div>
                  <button
                    onClick={closeDetailAndScrollUp}
                    className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  >
                    ↑ カレンダーに戻る
                  </button>
                </div>
                {dayRecords.length === 0 ? (
                  <p className="px-6 py-10 text-center text-gray-400">この日の記録はありません</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-6 py-3 text-sm font-bold text-gray-600">講師</th>
                        <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">種別</th>
                        <th className="text-left px-4 py-3 text-sm font-bold text-gray-600">内容</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">コマ数</th>
                        <th className="text-center px-4 py-3 text-sm font-bold text-gray-600">追加業務</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dayRecords.map((rec) => {
                        const color = LESSON_COLORS[rec.lesson_type] ?? { dot: '#9CA3AF', bg: '#F3F4F6', text: '#374151' }
                        return (
                          <tr key={rec.id}>
                            <td className="px-6 py-4 text-base font-medium text-gray-800 whitespace-nowrap">
                              {rec.teacher.name}
                            </td>
                            <td className="px-4 py-4">
                              <span
                                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full"
                                style={{ backgroundColor: color.bg, color: color.text }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.dot }} />
                                {rec.lesson_type}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">
                              {rec.lesson_type === '集団授業' && rec.notes ? rec.notes : '−'}
                            </td>
                            <td className="px-4 py-4 text-center text-base font-bold text-gray-800">
                              {rec.periods}コマ
                            </td>
                            <td className="px-4 py-4 text-center text-base text-gray-600">
                              {(rec.extra_minutes ?? 0) > 0 ? fmtMin(rec.extra_minutes ?? 0) : '−'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-orange-50">
                        <td colSpan={3} className="px-6 py-3 text-sm font-bold text-gray-700">合計</td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{totalPeriods}コマ</td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">
                          {totalExtra > 0 ? fmtMin(totalExtra) : '−'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )
          })() : (
            <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-400">
              <p className="text-base">カレンダーの日付をクリックすると、その日の勤務詳細がここに表示されます</p>
            </div>
          )}
          </div>

          {/* フローティング「カレンダーに戻る」ボタン：日付選択中は常時表示 */}
          {selectedDate && (
            <button
              onClick={closeDetailAndScrollUp}
              className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm text-white shadow-lg hover:shadow-xl transition-shadow"
              style={{ backgroundColor: ORANGE }}
              aria-label="カレンダーに戻る"
            >
              <span className="text-base leading-none">↑</span>
              カレンダーに戻る
            </button>
          )}
        </div>
        )}
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

        {/* ===== 夏期講習タブ ===== */}
        {activeTab === 'summer' && (() => {
          // 夏期講習期間中の日付一覧（休校日除く）を作成
          const dates: string[] = []
          const start = new Date(SUMMER_PERIOD.start + 'T00:00:00')
          const end = new Date(SUMMER_PERIOD.end + 'T00:00:00')
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay()
            if (dow === 0 || dow === 6) continue
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            const ds = `${y}-${m}-${day}`
            const isClosed = SUMMER_PERIOD.closedRanges.some(r => ds >= r.start && ds <= r.end)
            if (!isClosed) dates.push(ds)
          }

          // 講師ごと・日付ごとの提出スロット数を集計
          const countMap = new Map<string, number>() // key: `${teacher_id}_${date}`
          for (const r of summerRows) {
            const k = `${r.teacher_id}_${r.date}`
            countMap.set(k, (countMap.get(k) ?? 0) + 1)
          }

          // 講師ごとの提出セル合計
          const totalByTeacher = new Map<string, number>()
          for (const r of summerRows) {
            totalByTeacher.set(r.teacher_id, (totalByTeacher.get(r.teacher_id) ?? 0) + 1)
          }
          const totalPossible = dates.length * SUMMER_SLOTS.length

          // 講師×日付×スロットの詳細マップ
          const cellSet = new Set(summerRows.map(r => `${r.teacher_id}_${r.date}_${r.slot}`))
          // 確定状況：0=希望のみ / 1=1人 / 2=2人
          const confirmedCountMap = new Map<string, number>()
          for (const r of summerRows) {
            if (r.confirmed_count > 0) {
              confirmedCountMap.set(`${r.teacher_id}_${r.date}_${r.slot}`, r.confirmed_count)
            }
          }
          // 講師ごとの確定セル数（1人・2人の内訳）
          const confirmedByTeacher = new Map<string, { ones: number; twos: number }>()
          for (const r of summerRows) {
            if (r.confirmed_count > 0) {
              const cur = confirmedByTeacher.get(r.teacher_id) ?? { ones: 0, twos: 0 }
              if (r.confirmed_count === 2) cur.twos += 1
              else cur.ones += 1
              confirmedByTeacher.set(r.teacher_id, cur)
            }
          }

          const formatDateShort = (ds: string) => {
            const [, m, d] = ds.split('-').map(Number)
            return `${m}/${d}`
          }
          const dowOf = (ds: string) => new Date(ds + 'T00:00:00').getDay()
          const dowLabel = (ds: string) => '日月火水木金土'[dowOf(ds)]

          return (
            <>
              <div className="bg-white rounded-2xl shadow px-6 py-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-base font-bold text-gray-800">夏期講習シフト希望</span>
                  <span className="text-sm text-gray-500">
                    期間：{formatDateShort(SUMMER_PERIOD.start)} 〜 {formatDateShort(SUMMER_PERIOD.end)}
                    （対象 {dates.length} 日 × 5コマ = {totalPossible} セル）
                  </span>
                  {SUMMER_PERIOD.closedRanges.map((r) => (
                    <span key={r.start} className="text-xs text-gray-400">
                      {r.label}：{formatDateShort(r.start)}〜{formatDateShort(r.end)} は休校
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-gray-400">講師が更新すると自動で反映されます</span>
                </div>
              </div>

              {summerLoading ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">読み込み中...</div>
              ) : summerTeachers.length === 0 ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">講師が登録されていません</div>
              ) : (
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-orange-50">
                          <th className="sticky left-0 z-10 bg-orange-50 px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap min-w-[120px]">
                            講師
                          </th>
                          <th className="px-2 py-2 text-center font-bold text-gray-600 whitespace-nowrap">合計</th>
                          {dates.map(ds => {
                            const dow = dowOf(ds)
                            const color = dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#6b7280'
                            return (
                              <th key={ds} className="px-1.5 py-2 text-center font-bold whitespace-nowrap tabular-nums" style={{ color }}>
                                <div>{formatDateShort(ds)}</div>
                                <div className="text-[10px] font-normal">({dowLabel(ds)})</div>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {summerTeachers.map(t => {
                          const total = totalByTeacher.get(t.id) ?? 0
                          const isExpanded = expandedSummerTeacher === t.id
                          return (
                            <Fragment key={t.id}>
                              <tr
                                onClick={() => setExpandedSummerTeacher(isExpanded ? null : t.id)}
                                className="cursor-pointer hover:bg-orange-50"
                                style={{ backgroundColor: isExpanded ? '#FFF7ED' : undefined }}
                              >
                                <td className="sticky left-0 z-10 px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap"
                                  style={{ backgroundColor: isExpanded ? '#FFF7ED' : 'white' }}
                                >
                                  <div className="inline-flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                                      {t.name}
                                    </span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); downloadSingleSummerCsv(t) }}
                                      disabled={total === 0}
                                      className="text-[11px] font-bold hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
                                      style={{ color: ORANGE }}
                                      title={total === 0 ? '希望コマがありません' : `${t.name} 先生のシフトをCSVダウンロード`}
                                    >
                                      CSV
                                    </button>
                                  </div>
                                </td>
                                <td className="px-2 py-2.5 text-center font-bold tabular-nums whitespace-nowrap"
                                  style={{ color: total === 0 ? '#9ca3af' : '#374151' }}
                                >
                                  {total}<span className="text-gray-400 font-normal">/{totalPossible}</span>
                                  {(() => {
                                    const c = confirmedByTeacher.get(t.id)
                                    if (!c || (c.ones === 0 && c.twos === 0)) return null
                                    return (
                                      <div className="text-[10px] font-bold mt-0.5 leading-tight">
                                        {c.ones > 0 && (
                                          <span style={{ color: '#16A34A' }}>1人 {c.ones}</span>
                                        )}
                                        {c.ones > 0 && c.twos > 0 && <span className="text-gray-400"> / </span>}
                                        {c.twos > 0 && (
                                          <span style={{ color: '#1E3A8A' }}>2人 {c.twos}</span>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </td>
                                {dates.map(ds => {
                                  const c = countMap.get(`${t.id}_${ds}`) ?? 0
                                  const bg = c === 0 ? 'transparent' : c >= 4 ? '#DCFCE7' : c >= 2 ? '#FEF3C7' : '#FEE2E2'
                                  const fg = c === 0 ? '#d1d5db' : c >= 4 ? '#166534' : c >= 2 ? '#92400E' : '#991B1B'
                                  return (
                                    <td
                                      key={ds}
                                      className="px-1.5 py-2.5 text-center font-bold tabular-nums"
                                      style={{ backgroundColor: bg, color: fg }}
                                    >
                                      {c === 0 ? '−' : `${c}/5`}
                                    </td>
                                  )
                                })}
                              </tr>
                              {isExpanded && (
                                <tr className="bg-orange-50/30">
                                  <td colSpan={2 + dates.length} className="px-4 py-3">
                                    <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                                      <div className="text-xs text-gray-600 font-bold">{t.name} 先生 のコマごとの希望</div>
                                      <div className="text-[11px] text-gray-500">
                                        セルをクリックすると <span className="font-bold" style={{ color: '#16A34A' }}>確定</span> ⇄ <span className="font-bold" style={{ color: ORANGE }}>希望</span> を切り替えできます
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                        <span className="inline-flex items-center gap-1">
                                          <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: ORANGE }} />希望
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                          <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#16A34A' }} />確定
                                        </span>
                                      </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="text-xs">
                                        <thead>
                                          <tr>
                                            <th className="px-2 py-1 text-left font-bold text-gray-500 whitespace-nowrap"></th>
                                            {dates.map(ds => (
                                              <th key={ds} className="px-1.5 py-1 text-center font-normal text-gray-500 whitespace-nowrap tabular-nums">
                                                {formatDateShort(ds)}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {SUMMER_SLOTS.map(s => (
                                            <tr key={s.slot}>
                                              <td className="px-2 py-1 font-bold whitespace-nowrap" style={{ color: ORANGE }}>
                                                {s.label}　<span className="text-gray-500 font-normal">{s.start}〜{s.end}</span>
                                              </td>
                                              {dates.map(ds => {
                                                const key = `${t.id}_${ds}_${s.slot}`
                                                const on = cellSet.has(key)
                                                const count = confirmedCountMap.get(key) ?? 0
                                                const isToggling = togglingConfirmKey === key
                                                const bg = count === 2 ? '#1E3A8A' : count === 1 ? '#16A34A' : ORANGE
                                                const label = count === 2 ? '2人' : count === 1 ? '1人' : '✓'
                                                const nextLabel = count === 2 ? '希望' : count === 1 ? '2人' : '1人'
                                                return (
                                                  <td key={ds} className="px-1.5 py-1 text-center">
                                                    {on ? (
                                                      <button
                                                        onClick={() => cycleSummerConfirm(t.id, ds, s.slot, count)}
                                                        disabled={isToggling}
                                                        className="inline-flex items-center justify-center w-7 h-6 rounded text-white text-[10px] font-bold leading-none disabled:opacity-50 hover:opacity-90 active:scale-95 transition-transform"
                                                        style={{ backgroundColor: bg }}
                                                        title={`クリックで「${nextLabel}」に切替`}
                                                      >
                                                        {label}
                                                      </button>
                                                    ) : (
                                                      <span className="text-gray-300">・</span>
                                                    )}
                                                  </td>
                                                )
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="font-bold">提出数：</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#DCFCE7' }} />4〜5コマ</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#FEF3C7' }} />2〜3コマ</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#FEE2E2' }} />1コマ</span>
                      <span className="inline-flex items-center gap-1"><span className="text-gray-400">−</span>未提出</span>
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="font-bold">確定：</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-4 rounded text-white text-[9px] font-bold leading-none flex items-center justify-center" style={{ backgroundColor: ORANGE }}>✓</span>希望</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-4 rounded text-white text-[9px] font-bold leading-none flex items-center justify-center" style={{ backgroundColor: '#16A34A' }}>1</span>1人</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-4 rounded text-white text-[9px] font-bold leading-none flex items-center justify-center" style={{ backgroundColor: '#1E3A8A' }}>2</span>2人（満員）</span>
                    </span>
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* ===== 申込一覧タブ（保護者からの夏期講習申込） ===== */}
        {activeTab === 'apply' && (() => {
          const slotsByApply = new Map<string, SummerApplySlotRow[]>()
          for (const s of applySlots) {
            const list = slotsByApply.get(s.apply_id) ?? []
            list.push(s)
            slotsByApply.set(s.apply_id, list)
          }
          const fmtDateTime = (iso: string) => {
            const d = new Date(iso)
            const mm = String(d.getMonth() + 1).padStart(2, '0')
            const dd = String(d.getDate()).padStart(2, '0')
            const hh = String(d.getHours()).padStart(2, '0')
            const mi = String(d.getMinutes()).padStart(2, '0')
            return `${mm}/${dd} ${hh}:${mi}`
          }
          const totalSlots = applySlots.length
          const totalMain = applySlots.filter(s => isMainSlot(s.slot)).length
          const totalReserve = totalSlots - totalMain

          return (
            <>
              <div className="bg-white rounded-2xl shadow px-6 py-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-base font-bold text-gray-800">夏期講習 お申込み一覧</span>
                  <span className="text-sm text-gray-500">
                    申込件数：<span className="font-bold text-gray-700">{applyRows.length}</span> 件
                    （希望コマ計 メイン {totalMain} / 予備 {totalReserve}）
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={downloadApplyCsv}
                      disabled={applyRows.length === 0}
                      className="px-4 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-50"
                      style={{ backgroundColor: ORANGE }}
                    >
                      CSVダウンロード
                    </button>
                    <button
                      onClick={openBulkDeleteModal}
                      disabled={applyRows.length === 0 || !csvDownloadedThisSession || bulkDeletingApply}
                      className="px-4 py-2 rounded-lg text-sm font-bold border-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: '#dc2626', color: '#dc2626', backgroundColor: 'white' }}
                      title={!csvDownloadedThisSession ? '先にCSVをダウンロードしてください' : '全件削除'}
                    >
                      {bulkDeletingApply ? '削除中…' : '全件削除'}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  保護者が申込フォームから送信すると自動で反映されます。
                  次シーズンの受付前は「CSVダウンロード」で保管 → 「全件削除」で空にしてください。
                </div>
                {applyRows.length > 0 && !csvDownloadedThisSession && (
                  <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                    全件削除するには、先に「CSVダウンロード」を押してデータを保存してください。
                    （新しい申込が届いた場合は、再度CSVダウンロードが必要です）
                  </div>
                )}
              </div>

              {applyLoading ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">読み込み中...</div>
              ) : applyRows.length === 0 ? (
                <div className="bg-white rounded-2xl shadow p-12 text-center text-gray-400">
                  まだお申込みはありません
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-orange-50 text-xs">
                          <th className="px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap">申込日時</th>
                          <th className="px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap">お子さんの名前</th>
                          <th className="px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap">学年</th>
                          <th className="px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap">希望コース</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">メイン</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">予備</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">合計</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">確定</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">要望</th>
                          <th className="px-3 py-2 text-center font-bold text-gray-600 whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {applyRows.map(r => {
                          const slots = slotsByApply.get(r.id) ?? []
                          const mainCount = slots.filter(s => isMainSlot(s.slot)).length
                          const reserveCount = slots.length - mainCount
                          const confirmedCount = slots.filter(s => s.is_confirmed).length
                          const isExpanded = expandedApplyId === r.id
                          const hasNotes = !!(r.notes && r.notes.trim())
                          return (
                            <Fragment key={r.id}>
                              <tr
                                onClick={() => setExpandedApplyId(isExpanded ? null : r.id)}
                                className="cursor-pointer hover:bg-orange-50"
                                style={{ backgroundColor: isExpanded ? '#FFF7ED' : undefined }}
                              >
                                <td className="px-3 py-2.5 text-xs text-gray-600 tabular-nums whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                                    {fmtDateTime(r.created_at)}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{r.student_name}</td>
                                <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.grade ?? '-'}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {r.course ? (
                                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: '#FFF7ED', color: ORANGE, border: `1px solid ${ORANGE}` }}>
                                      {r.course}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 text-xs">−</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center font-bold tabular-nums whitespace-nowrap"
                                  style={{ color: mainCount === 0 ? '#9ca3af' : ORANGE }}
                                >
                                  {mainCount}
                                </td>
                                <td className="px-3 py-2.5 text-center tabular-nums text-gray-600 whitespace-nowrap">
                                  {reserveCount}
                                </td>
                                <td className="px-3 py-2.5 text-center font-bold tabular-nums text-gray-700 whitespace-nowrap">
                                  {slots.length}
                                </td>
                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                  {slots.length === 0 ? (
                                    <span className="text-gray-300 text-xs">−</span>
                                  ) : confirmedCount === 0 ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: 'white' }}>
                                      未
                                    </span>
                                  ) : confirmedCount === slots.length ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: '#16A34A' }}>
                                      完了 {confirmedCount}/{slots.length}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                                      {confirmedCount}/{slots.length}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                  {hasNotes ? (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: ORANGE, color: 'white' }}>
                                      あり
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 text-xs">−</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  <div className="inline-flex items-center gap-3">
                                    <button
                                      onClick={() => downloadSingleApplyCsv(r)}
                                      className="text-xs font-bold hover:underline"
                                      style={{ color: ORANGE }}
                                    >
                                      CSV
                                    </button>
                                    <button
                                      onClick={() => handleDeleteApply(r.id, r.student_name)}
                                      disabled={deletingApplyId === r.id}
                                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-40 font-bold"
                                    >
                                      {deletingApplyId === r.id ? '削除中…' : '削除'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (() => {
                                // 申込内の日付一覧を抽出（日付順）
                                const dateSet = new Set<string>()
                                slots.forEach(s => dateSet.add(s.date))
                                const dates = Array.from(dateSet).sort()
                                const fmtDateShort = (ds: string) => {
                                  const [, m, d] = ds.split('-').map(Number)
                                  const dow = new Date(ds + 'T00:00:00').getDay()
                                  return { label: `${m}/${d}`, dow }
                                }
                                return (
                                  <tr className="bg-orange-50/30">
                                    <td colSpan={10} className="px-4 py-3">
                                      {hasNotes && (
                                        <div className="mb-3 bg-white border border-orange-200 rounded-lg px-3 py-2">
                                          <div className="text-[11px] font-bold text-gray-500 mb-1">ご要望</div>
                                          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{r.notes}</div>
                                        </div>
                                      )}
                                      {(() => {
                                        const confirmedSlots = slots
                                          .filter(s => s.is_confirmed)
                                          .slice()
                                          .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
                                        if (confirmedSlots.length === 0) return null
                                        return (
                                          <div className="mb-3 bg-white border border-green-300 rounded-lg px-3 py-2.5">
                                            <div className="text-xs font-bold mb-2" style={{ color: '#15803d' }}>
                                              担当割り当て
                                              <span className="ml-2 font-normal text-gray-500">― 確定済みのコマに担当の先生と科目をご指定ください</span>
                                            </div>
                                            <div className="space-y-1.5">
                                              {confirmedSlots.map(s => {
                                                const info = SUMMER_SLOTS.find(x => x.slot === s.slot)!
                                                const [, mm, dd] = s.date.split('-').map(Number)
                                                const dow = '日月火水木金土'[new Date(s.date + 'T00:00:00').getDay()]
                                                const main = isMainSlot(s.slot)
                                                return (
                                                  <div key={`${s.date}_${s.slot}`} className="flex items-center gap-2 text-xs flex-wrap">
                                                    <span className="tabular-nums text-gray-700 font-semibold whitespace-nowrap">
                                                      {mm}/{dd}({dow}) {info.label} {info.start}〜{info.end}
                                                    </span>
                                                    <span
                                                      className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                                      style={
                                                        main
                                                          ? { backgroundColor: ORANGE, color: 'white' }
                                                          : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }
                                                      }
                                                    >
                                                      {main ? 'メイン' : '予備'}
                                                    </span>
                                                    <select
                                                      value={s.assigned_teacher_id ?? ''}
                                                      onChange={(e) => setApplyAssignment(r.id, s.date, s.slot, e.target.value || null)}
                                                      className="ml-auto border-2 rounded px-2 py-1 text-xs bg-white font-semibold"
                                                      style={{ borderColor: s.assigned_teacher_id ? '#16A34A' : '#e5e7eb', color: s.assigned_teacher_id ? '#15803d' : '#6b7280' }}
                                                    >
                                                      <option value="">— 担当を選ぶ —</option>
                                                      {summerTeachers.map(t => (
                                                        <option key={t.id} value={t.id}>
                                                          {t.name} 先生
                                                        </option>
                                                      ))}
                                                    </select>
                                                    <select
                                                      value={s.subject ?? ''}
                                                      onChange={(e) => setApplySubject(r.id, s.date, s.slot, e.target.value || null)}
                                                      className="border-2 rounded px-2 py-1 text-xs bg-white font-semibold"
                                                      style={{ borderColor: s.subject ? '#0EA5E9' : '#e5e7eb', color: s.subject ? '#0369A1' : '#6b7280' }}
                                                    >
                                                      <option value="">— 科目を選ぶ —</option>
                                                      {SUBJECT_OPTIONS.map(o => (
                                                        <option key={o.value} value={o.value}>
                                                          {o.label}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          </div>
                                        )
                                      })()}
                                      {dates.length === 0 ? (
                                        <div className="text-xs text-gray-500 px-2 py-1">希望コマの登録がありません</div>
                                      ) : (
                                        <div className="overflow-x-auto">
                                          <div className="text-xs font-bold text-gray-600 mb-2">
                                            希望の日・時間帯（メイン={SUMMER_SLOTS.filter(s=>isMainSlot(s.slot)).map(s=>s.label).join('・')}）
                                            <span className="ml-2 font-normal text-gray-500">― ✓をクリックすると緑の「確定」に切替（もう一度押すと希望に戻る）／<span className="text-blue-700 font-bold">青の点線枠</span>は管理者追加コマ</span>
                                          </div>
                                          <table className="text-xs">
                                            <thead>
                                              <tr>
                                                <th className="px-2 py-1 text-left font-bold text-gray-500 whitespace-nowrap"></th>
                                                {dates.map(ds => {
                                                  const { label, dow } = fmtDateShort(ds)
                                                  const color = dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#6b7280'
                                                  return (
                                                    <th key={ds} className="px-1.5 py-1 text-center font-bold whitespace-nowrap tabular-nums" style={{ color }}>
                                                      <div>{label}</div>
                                                      <div className="text-[10px] font-normal">({'日月火水木金土'[dow]})</div>
                                                    </th>
                                                  )
                                                })}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {SUMMER_SLOTS.map(s => {
                                                const main = isMainSlot(s.slot)
                                                return (
                                                  <tr key={s.slot}>
                                                    <td className="px-2 py-1 font-bold whitespace-nowrap" style={{ color: main ? ORANGE : '#9ca3af' }}>
                                                      {s.label}　<span className="text-gray-500 font-normal">{s.start}〜{s.end}</span>
                                                      <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded"
                                                        style={main
                                                          ? { backgroundColor: ORANGE, color: 'white' }
                                                          : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}
                                                      >
                                                        {main ? 'メイン' : '予備'}
                                                      </span>
                                                    </td>
                                                    {dates.map(ds => {
                                                      const key = `${ds}_${s.slot}`
                                                      const slotRow = slots.find(sl => sl.date === ds && sl.slot === s.slot)
                                                      const on = !!slotRow
                                                      const conf = !!slotRow?.is_confirmed
                                                      const isAdminAdded = !!slotRow?.added_by_admin
                                                      const toggleKey = `${r.id}_${ds}_${s.slot}`
                                                      const isToggling = togglingApplyConfirmKey === toggleKey
                                                      return (
                                                        <td key={key} className="px-1.5 py-1 text-center">
                                                          {on ? (
                                                            <button
                                                              onClick={() => toggleApplyConfirm(r.id, ds, s.slot, conf)}
                                                              disabled={isToggling}
                                                              className="inline-flex items-center justify-center w-6 h-6 rounded text-white text-[10px] font-bold leading-none disabled:opacity-50 hover:opacity-90 active:scale-95 transition-transform"
                                                              style={{
                                                                backgroundColor: conf ? '#16A34A' : (main ? ORANGE : '#9ca3af'),
                                                                outline: isAdminAdded ? '2px dashed #1d4ed8' : 'none',
                                                                outlineOffset: isAdminAdded ? '1px' : '0',
                                                              }}
                                                              title={`${isAdminAdded ? '管理者追加コマ：' : '保護者申込コマ：'}${conf ? 'クリックで「希望」に戻す' : 'クリックで「確定」にする'}`}
                                                            >
                                                              {conf ? '確定' : '✓'}
                                                            </button>
                                                          ) : (
                                                            <span className="text-gray-300">・</span>
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
                                      {/* 管理者追加コマセクション */}
                                      {(() => {
                                        const adminAdded = slots
                                          .filter(s => s.added_by_admin)
                                          .slice()
                                          .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)
                                        return (
                                          <div className="mt-3 bg-white border border-blue-200 rounded-lg px-3 py-2.5">
                                            <div className="text-xs font-bold mb-2" style={{ color: '#1d4ed8' }}>
                                              管理者追加コマ
                                              <span className="ml-2 font-normal text-gray-500">― 保護者と合意の上で、後からコマを追加できます（保護者申込分は削除不可）</span>
                                            </div>
                                            <div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
                                              <select
                                                value={adminAddDate}
                                                onChange={(e) => setAdminAddDate(e.target.value)}
                                                className="border-2 border-gray-200 rounded px-2 py-1 text-xs bg-white font-semibold"
                                                disabled={addingAdminSlot}
                                              >
                                                <option value="">— 日付 —</option>
                                                {summerApplyDates.map(d => {
                                                  const [, mm, dd] = d.split('-').map(Number)
                                                  const dow = '日月火水木金土'[new Date(d + 'T00:00:00').getDay()]
                                                  return <option key={d} value={d}>{mm}/{dd}({dow})</option>
                                                })}
                                              </select>
                                              <select
                                                value={adminAddSlot}
                                                onChange={(e) => setAdminAddSlot(e.target.value)}
                                                className="border-2 border-gray-200 rounded px-2 py-1 text-xs bg-white font-semibold"
                                                disabled={addingAdminSlot}
                                              >
                                                <option value="">— コマ —</option>
                                                {SUMMER_SLOTS.map(slotInfo => (
                                                  <option key={slotInfo.slot} value={slotInfo.slot}>
                                                    {slotInfo.label} {slotInfo.start}〜{slotInfo.end} {isMainSlot(slotInfo.slot) ? '(メイン)' : '(予備)'}
                                                  </option>
                                                ))}
                                              </select>
                                              <button
                                                onClick={async () => {
                                                  if (!adminAddDate || !adminAddSlot) return
                                                  await addAdminApplySlot(r.id, adminAddDate, parseInt(adminAddSlot))
                                                  setAdminAddDate('')
                                                  setAdminAddSlot('')
                                                }}
                                                disabled={!adminAddDate || !adminAddSlot || addingAdminSlot}
                                                className="px-3 py-1 rounded text-white text-xs font-bold disabled:opacity-40"
                                                style={{ backgroundColor: '#1d4ed8' }}
                                              >
                                                {addingAdminSlot ? '追加中…' : '＋ 追加'}
                                              </button>
                                            </div>
                                            {adminAdded.length === 0 ? (
                                              <div className="text-[11px] text-gray-400 px-1">管理者追加コマはまだありません</div>
                                            ) : (
                                              <div className="space-y-1">
                                                {adminAdded.map(s => {
                                                  const info = SUMMER_SLOTS.find(x => x.slot === s.slot)!
                                                  const [, mm, dd] = s.date.split('-').map(Number)
                                                  const dow = '日月火水木金土'[new Date(s.date + 'T00:00:00').getDay()]
                                                  return (
                                                    <div key={`${s.date}_${s.slot}`} className="flex items-center gap-2 text-xs flex-wrap">
                                                      <span className="font-bold" style={{ color: '#1d4ed8' }}>＋</span>
                                                      <span className="tabular-nums text-gray-700 whitespace-nowrap">
                                                        {mm}/{dd}({dow}) {info.label} {info.start}〜{info.end}
                                                      </span>
                                                      <span
                                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                                        style={
                                                          isMainSlot(s.slot)
                                                            ? { backgroundColor: ORANGE, color: 'white' }
                                                            : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }
                                                        }
                                                      >
                                                        {isMainSlot(s.slot) ? 'メイン' : '予備'}
                                                      </span>
                                                      {s.is_confirmed && (
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: '#16A34A', color: 'white' }}>
                                                          確定
                                                        </span>
                                                      )}
                                                      <button
                                                        onClick={() => removeAdminApplySlot(r.id, s.date, s.slot)}
                                                        className="ml-auto text-[11px] font-bold text-red-600 hover:text-red-700 underline"
                                                      >
                                                        削除
                                                      </button>
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })()}
                                    </td>
                                  </tr>
                                )
                              })()}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )
        })()}

      </div>

      {/* 全件削除 確認モーダル */}
      {bulkDeleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => { if (!bulkDeletingApply) setBulkDeleteModalOpen(false) }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: '#dc2626' }}>
                注意
              </span>
              <h3 className="text-lg font-bold text-gray-800">申込一覧を全件削除</h3>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 mb-4">
              <div className="text-sm text-red-800 leading-relaxed">
                <span className="font-bold">{applyRows.length} 件</span> の申込をすべて削除します。
              </div>
              <div className="text-xs text-red-700 mt-1 leading-relaxed">
                希望コマも含めて完全に削除され、<span className="font-bold">元に戻せません</span>。
              </div>
            </div>
            <div className="text-sm text-gray-700 mb-2 leading-relaxed">
              本当に削除する場合は、下の欄に <span className="font-bold" style={{ color: '#dc2626' }}>削除します</span> と入力してください。
            </div>
            <input
              type="text"
              value={bulkDeleteConfirmText}
              onChange={(e) => setBulkDeleteConfirmText(e.target.value)}
              placeholder="削除します"
              autoFocus
              disabled={bulkDeletingApply}
              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-lg text-base focus:outline-none focus:border-red-400 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setBulkDeleteModalOpen(false)}
                disabled={bulkDeletingApply}
                className="flex-1 py-2.5 rounded-lg border-2 border-gray-200 text-gray-700 text-sm font-bold disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={executeBulkDeleteApply}
                disabled={bulkDeleteConfirmText !== '削除します' || bulkDeletingApply}
                className="flex-1 py-2.5 rounded-lg text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#dc2626' }}
              >
                {bulkDeletingApply ? '削除中…' : '全件削除を実行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
