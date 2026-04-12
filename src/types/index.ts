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
  { label: '①', start: '17:05', end: '17:50' },
  { label: '②', start: '18:10', end: '18:55' },
  { label: '③', start: '19:05', end: '19:50' },
  { label: '④', start: '19:55', end: '20:40' },
  { label: '⑤', start: '20:45', end: '21:30' },
] as const
