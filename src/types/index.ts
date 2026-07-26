export type Teacher = {
  id: string
  name: string
  password: string
  code: number
  is_admin: boolean
  created_at: string
}

export type Attendance = {
  id: string
  teacher_id: string
  date: string
  periods: number
  start_time: string | null
  end_time: string | null
  lesson_type: string
  notes: string | null
  extra_minutes: number
  created_at: string
}

export type LoggedInTeacher = {
  id: string
  name: string
  is_admin: boolean
}

// ===== 授業準備時間（自動付与） =====
// 授業前後の準備として、個別指導が1コマ以上あった日に 1日 PREP_MINUTES_PER_DAY 分を付与する。
// DBには保存せず、勤怠レコードから毎回計算する（＝過去の記録にも遡って反映され、
// 管理画面でコマ数を修正しても自動で計算し直される）。
export const PREP_MINUTES_PER_DAY = 10

type PrepSource = { date: string; lesson_type: string; periods: number }

// 付与条件：その日に「個別指導」で1コマ以上の記録があること
function qualifiesForPrep(r: Pick<PrepSource, 'lesson_type' | 'periods'>): boolean {
  return r.lesson_type === '個別指導' && r.periods > 0
}

// 1日分のレコード（個別＋集団）から、その日に付与される準備時間（分）を返す
export function prepMinutesForDay(
  dayRecords: Pick<PrepSource, 'lesson_type' | 'periods'>[]
): number {
  return dayRecords.some(qualifiesForPrep) ? PREP_MINUTES_PER_DAY : 0
}

// 複数日ぶんのレコードから、準備時間の合計（分）を返す。
// 1日に複数レコード（個別＋集団）があっても、その日の付与は1回だけ。
export function prepMinutesTotal(records: PrepSource[]): number {
  const days = new Set(records.filter(qualifiesForPrep).map((r) => r.date))
  return days.size * PREP_MINUTES_PER_DAY
}

export const GROUP_SLOTS = [
  { label: '①', start: '17:05', end: '18:05' },
  { label: '②', start: '18:10', end: '18:55' },
  { label: '③', start: '19:05', end: '19:50' },
  { label: '④', start: '19:55', end: '20:40' },
  { label: '⑤', start: '20:45', end: '21:30' },
] as const

export const SHIFT_SLOTS = [
  { slot: 1, label: '枠1', start: '17:05', end: '18:05' },
  { slot: 2, label: '枠2', start: '18:15', end: '19:50' },
  { slot: 3, label: '枠3', start: '19:55', end: '21:30' },
] as const

export type ShiftRequest = {
  id: string
  teacher_id: string
  date: string
  slot: number
  created_at: string
}

// 夏期講習：時間帯定義（5コマ）
export const SUMMER_SLOTS = [
  { slot: 1, label: '①', start: '13:15', end: '14:50' },
  { slot: 2, label: '②', start: '14:55', end: '16:30' },
  { slot: 3, label: '③', start: '16:35', end: '18:10' },
  { slot: 4, label: '④', start: '18:15', end: '19:50' },
  { slot: 5, label: '⑤', start: '19:55', end: '21:30' },
] as const

// 夏期講習：期間定義（講師シフト＆管理画面用）
// 7月分は夏期講習に収まりきれなかった分の通常授業調整等で活用するため、提出・閲覧対象に含める
export const SUMMER_PERIOD = {
  start: '2026-07-21',
  end: '2026-08-28',
  closedRanges: [
    { start: '2026-07-29', end: '2026-07-31', label: '休校日' },
    { start: '2026-08-08', end: '2026-08-16', label: 'お盆休み' },
  ],
} as const

// 保護者向け申込フォーム用の期間（夏期講習の実施期間）
// 講師シフトの期間とは別管理：保護者からは8月分のみを対象に申込を受け付ける
export const SUMMER_APPLY_PERIOD = {
  start: '2026-08-03',
  end: '2026-08-28',
  closedRanges: [
    { start: '2026-08-08', end: '2026-08-16', label: 'お盆休み' },
  ],
} as const

// メインの時間帯は②・③。ただし下記の日付は全時間帯を「予備」として運用する
export const RESERVE_ONLY_DATES: ReadonlyArray<string> = [
  '2026-08-03',
  '2026-08-04',
]

export function isMainSlotOnDate(date: string, slot: number): boolean {
  if (RESERVE_ONLY_DATES.includes(date)) return false
  return slot === 2 || slot === 3
}

export type SummerAvailability = {
  id: string
  teacher_id: string
  date: string
  slot: number
  // 確定状況：0=希望のみ / 1=1人入った / 2=2人入った（満員）
  confirmed_count: number
  created_at: string
}

// 保護者向け申込フォームの学年選択肢
export const APPLY_GRADES = [
  '小1', '小2', '小3', '小4', '小5', '小6',
  '中1', '中2', '中3',
  '高1', '高2', '高3',
] as const

export type ApplyGrade = typeof APPLY_GRADES[number]

export type SummerApply = {
  id: string
  student_name: string
  grade: string | null
  course: string | null
  notes: string | null
  created_at: string
}

export type SummerApplySlot = {
  id: string
  apply_id: string
  date: string
  slot: number
}
