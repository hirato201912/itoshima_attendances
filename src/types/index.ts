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

// 季節講習（夏期・冬期）の講師シフト提出期間の型
export type SeasonPeriod = {
  start: string
  end: string
  includeWeekends: boolean
  deadline?: string
  closedRanges: ReadonlyArray<{ start: string; end: string; label: string }>
  // 使う時間帯（省略時は SUMMER_SLOTS の全5コマ）
  slots?: ReadonlyArray<number>
  // 特別な日のお知らせ（画面上部の注意書き＋日付の下の短い表示）
  specialDays?: ReadonlyArray<{ dates: ReadonlyArray<string>; tag: string; note: string }>
}

export function seasonSlots(period: SeasonPeriod) {
  return SUMMER_SLOTS.filter(s => !period.slots || period.slots.includes(s.slot))
}

// 夏期講習：期間定義（講師シフト＆管理画面用）
// 7月分は夏期講習に収まりきれなかった分の通常授業調整等で活用するため、提出・閲覧対象に含める
export const SUMMER_PERIOD = {
  start: '2026-07-21',
  end: '2026-08-28',
  includeWeekends: false,
  closedRanges: [
    { start: '2026-07-29', end: '2026-07-31', label: '休校日' },
    { start: '2026-08-08', end: '2026-08-16', label: 'お盆休み' },
  ],
} as const

// 冬期講習：期間定義（講師シフト用）。時間帯は②〜⑤（①は夏期で使わなかったため除外）、土日も提出対象
// シフト保存先は夏期講習と同じ juku_summer_availability（日付範囲で区別する）
// 12/29・30 は講師が集まらなかったため休み（2026-11-13 決定）
export const WINTER_PERIOD = {
  start: '2026-12-24',
  end: '2027-01-07',
  includeWeekends: true,
  deadline: '2026-11-10',
  slots: [2, 3, 4, 5],
  specialDays: [
    { dates: ['2026-12-28'], tag: '中3講座', note: 'は②・③で中3向けの特別講座（少人数）を行います。' },
  ],
  closedRanges: [
    { start: '2026-12-26', end: '2026-12-27', label: '休校日' },
    { start: '2026-12-29', end: '2027-01-03', label: '年末年始休み' },
  ],
} as const

// 保護者向け申込フォーム用の期間（講師シフトの期間とは別管理）
export type ApplyPeriod = {
  start: string
  end: string
  includeWeekends: boolean
  closedRanges: ReadonlyArray<{ start: string; end: string; label: string }>
  // 申込フォーム・管理画面で扱う時間帯
  slots: ReadonlyArray<number>
}

// 夏期講習：保護者からは8月分のみを対象に申込を受け付ける
export const SUMMER_APPLY_PERIOD: ApplyPeriod = {
  start: '2026-08-03',
  end: '2026-08-28',
  includeWeekends: false,
  closedRanges: [
    { start: '2026-08-08', end: '2026-08-16', label: 'お盆休み' },
  ],
  slots: [1, 2, 3, 4, 5],
}

// 冬期講習：メインは②・③、④・⑤は予備
export const WINTER_APPLY_PERIOD: ApplyPeriod = {
  start: '2026-12-24',
  end: '2027-01-07',
  includeWeekends: true,
  closedRanges: [
    { start: '2026-12-26', end: '2026-12-27', label: '休校日' },
    { start: '2026-12-29', end: '2027-01-03', label: '年末年始休み' },
  ],
  slots: [2, 3, 4, 5],
}

// 申込期間の日付一覧（土日・休校区間を除く）
export function applyDates(period: ApplyPeriod): string[] {
  const out: string[] = []
  const start = new Date(period.start + 'T00:00:00')
  const end = new Date(period.end + 'T00:00:00')
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (!period.includeWeekends && (dow === 0 || dow === 6)) continue
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (period.closedRanges.some(r => ds >= r.start && ds <= r.end)) continue
    out.push(ds)
  }
  return out
}

// 冬期講習：中3向け特別講座（少人数・1コマ1,100円税込）。個別のコマとは別扱いで、片方だけでも選べる。
// ②＝入試国語（作文問題対策）、③＝入試英語（英作文問題対策）
// 中3はこの日時を個別のコマとしては選べない（中3以外は個別で選べる）
export const WINTER_SPECIAL_COURSE = {
  grade: '中3',
  date: '2026-12-28',
  slots: [2, 3],
  pricePerSlot: 1100,
} as const

// 中3特別講座のコマごとの科目・テーマ（保護者画面・管理画面で共通）
export const WINTER_SPECIAL_TOPICS: Readonly<Record<number, { subject: string; theme: string }>> = {
  2: { subject: '国語', theme: '作文問題対策' },
  3: { subject: '英語', theme: '英作文問題対策' },
}

// 冬期講習：保護者が選べない日時（講師が確保できないため）
export const WINTER_UNAVAILABLE_SLOTS: Readonly<Record<string, ReadonlyArray<number>>> = {
  '2026-12-24': [4, 5],
  '2026-12-25': [4, 5],
}

// メインの時間帯は②・③。ただし下記の日付は全時間帯を「予備」として運用する
export const RESERVE_ONLY_DATES: ReadonlyArray<string> = [
  '2026-08-03',
  '2026-08-04',
]

// 下記の日付はメインの時間帯を個別に指定する
export const MAIN_SLOTS_BY_DATE: Readonly<Record<string, ReadonlyArray<number>>> = {}

export function isMainSlotOnDate(date: string, slot: number): boolean {
  if (RESERVE_ONLY_DATES.includes(date)) return false
  const override = MAIN_SLOTS_BY_DATE[date]
  if (override) return override.includes(slot)
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
  // 'summer' | 'winter'（既存の申込は 'summer'）
  season: string
  // 冬期講習の中3特別講座で選んだ時間帯（例：[2, 3]）。なければ null
  special_slots: number[] | null
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
