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

// 夏期講習：期間定義（複数の休校期間に対応）
export const SUMMER_PERIOD = {
  start: '2026-07-21',
  end: '2026-08-28',
  closedRanges: [
    { start: '2026-07-29', end: '2026-07-31', label: '休校日' },
    { start: '2026-08-08', end: '2026-08-16', label: 'お盆休み' },
  ],
} as const

export type SummerAvailability = {
  id: string
  teacher_id: string
  date: string
  slot: number
  is_confirmed: boolean
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
