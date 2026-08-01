'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { GROUP_SLOTS, SUMMER_PERIOD, PREP_MINUTES_PER_DAY, prepMinutesForDay } from '@/types'
import type { Attendance, LoggedInTeacher } from '@/types'

// 日本時間の今日を返す。toISOString() は UTC 基準のため、
// 深夜0時〜朝9時に送信すると前日の日付で登録されてしまう（給与集計がズレる）
function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function formatDateLabel(d: string) {
  const date = new Date(d + 'T00:00:00')
  const day = '日月火水木金土'[date.getDay()]
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${day}）`
}

// 夏期講習のシフト提出バナーは一旦非表示。再開するときは true に戻す
const SHOW_SUMMER_BANNER: boolean = false

// 授業前後の準備時間（業務給）についてのお知らせ。この日付まで表示する
const PREP_NOTICE_END = '2026-08-31'

// 画面上部に常時表示する合言葉
const WELCOME_PHRASE = '「よく来たね」で迎えて、「よくがんばったね」で送り出す。'

type Step = 'form' | 'confirm'

export default function AttendancePage() {
  const router = useRouter()
  const [teacher, setTeacher] = useState<LoggedInTeacher | null>(null)
  const [checking, setChecking] = useState(true)
  const [todayRecords, setTodayRecords] = useState<Attendance[]>([])
  const [step, setStep] = useState<Step>('form')

  const [periods, setPeriods] = useState(0)
  const [selectedSlots, setSelectedSlots] = useState<string[]>([])
  const [extraMinutes, setExtraMinutes] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [showSummerBanner, setShowSummerBanner] = useState(false)
  const [showPrepNotice, setShowPrepNotice] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (!saved) {
      router.replace('/')
      return
    }
    const t: LoggedInTeacher = JSON.parse(saved)
    setTeacher(t)

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    const dismissed = localStorage.getItem('juku_install_banner_dismissed') === '1'
    setShowInstallBanner(!isStandalone && !dismissed)

    // 夏期講習バナー：期間終了まで表示
    const todayDate = today()
    setShowSummerBanner(SHOW_SUMMER_BANNER && todayDate <= SUMMER_PERIOD.end)
    setShowPrepNotice(todayDate <= PREP_NOTICE_END)

    // 本日送信済みか確認
    supabase
      .from('itoshima_attendances')
      .select('*')
      .eq('teacher_id', t.id)
      .eq('date', today())
      .order('created_at')
      .then(({ data }) => {
        setTodayRecords(data ?? [])
        setChecking(false)
      })
  }, [router])

  const toggleSlot = (label: string) => {
    setSelectedSlots((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    )
  }

  const extra = extraMinutes === '' ? 0 : Math.max(0, parseInt(extraMinutes) || 0)
  const sortedSlots = [...selectedSlots].sort()
  const hasIndividual = periods > 0
  const hasGroup = selectedSlots.length > 0
  const hasContent = hasIndividual || hasGroup || extra > 0

  const handleToConfirm = () => {
    setError('')
    if (!hasContent) {
      setError('コマ数の入力か時間帯の選択をしてください')
      return
    }
    setStep('confirm')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async () => {
    if (!teacher) return
    setLoading(true)
    setError('')

    const records: Record<string, unknown>[] = []

    if (hasIndividual || (!hasGroup && extra > 0)) {
      records.push({
        teacher_id: teacher.id,
        date: today(),
        periods,
        start_time: null,
        end_time: null,
        lesson_type: '個別指導',
        extra_minutes: extra,
        notes: null,
      })
    }

    if (hasGroup) {
      const first = GROUP_SLOTS.find((s) => s.label === sortedSlots[0])!
      const last = GROUP_SLOTS.find((s) => s.label === sortedSlots[sortedSlots.length - 1])!
      records.push({
        teacher_id: teacher.id,
        date: today(),
        periods: selectedSlots.length,
        start_time: first.start,
        end_time: last.end,
        lesson_type: '集団授業',
        extra_minutes: hasIndividual ? 0 : extra,
        notes: sortedSlots.join(''),
      })
    }

    const { data: inserted, error: err } = await supabase
      .from('itoshima_attendances')
      .insert(records)
      .select()

    setLoading(false)

    if (err) {
      setError('送信に失敗しました。もう一度お試しください。')
      setStep('form')
    } else {
      setTodayRecords(inserted ?? [])
      setStep('form')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('juku_teacher')
    router.push('/')
  }

  if (!teacher || checking) return null

  // 本日送信済み
  const submitted = todayRecords.length > 0
  const submittedIndividual = todayRecords.find((r) => r.lesson_type === '個別指導')
  const submittedGroup = todayRecords.find((r) => r.lesson_type === '集団授業')
  const totalExtra = todayRecords.reduce((sum, r) => sum + (r.extra_minutes ?? 0), 0)
  const totalPeriods = todayRecords.reduce((sum, r) => sum + r.periods, 0)
  // 個別指導が1コマ以上あれば準備時間を自動付与（送信後の表示用）
  const submittedPrep = prepMinutesForDay(todayRecords)

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
          <Link href="/shift" className="text-white/90 text-sm underline underline-offset-2">
            空き時間登録
          </Link>
          <Link href="/summer" className="text-white/90 text-sm underline underline-offset-2">
            夏期講習
          </Link>
          <Link href="/history" className="text-white/90 text-sm underline underline-offset-2">
            勤怠履歴
          </Link>
          <button
            onClick={handleLogout}
            className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="bg-white border-b border-orange-100">
        <p
          className="max-w-lg mx-auto px-4 py-2.5 text-center text-sm font-bold leading-snug"
          style={{ color: '#CC5500' }}
        >
          {WELCOME_PHRASE}
        </p>
      </div>

      <main className="max-w-lg mx-auto px-4 py-6">

        {showSummerBanner && (
          <Link
            href="/summer"
            className="mb-4 block rounded-2xl p-4 shadow-md text-white transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #FF7F00 0%, #FF9933 100%)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white/80 mb-0.5">夏期講習シフトのお知らせ</p>
                <p className="text-base font-bold leading-snug">
                  出られる日・時間帯を提出してください
                </p>
                <p className="text-xs text-white/85 mt-1">
                  {(() => {
                    const s = new Date(SUMMER_PERIOD.start + 'T00:00:00')
                    const e = new Date(SUMMER_PERIOD.end + 'T00:00:00')
                    const dow = '日月火水木金土'
                    return `${s.getMonth() + 1}/${s.getDate()}（${dow[s.getDay()]}）〜 ${e.getMonth() + 1}/${e.getDate()}（${dow[e.getDay()]}）の希望を入力 ›`
                  })()}
                </p>
              </div>
              <div className="shrink-0 text-2xl font-bold">›</div>
            </div>
          </Link>
        )}

        {showPrepNotice && (
          <div className="mb-4 bg-white rounded-2xl border border-orange-200 overflow-hidden">
            <div className="px-4 py-2.5" style={{ backgroundColor: '#FFF0E0' }}>
              <p className="text-xs font-bold" style={{ color: '#CC5500' }}>
                お知らせ
              </p>
              <p className="text-base font-bold text-gray-800 leading-snug mt-0.5">
                8月から、授業の前後に業務給{PREP_MINUTES_PER_DAY}分が自動で付きます
              </p>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <p className="text-xs text-gray-500">
                個別指導が1コマ以上ある日は、申請しなくても1日{PREP_MINUTES_PER_DAY}分が加算されます。
              </p>
              <p className="text-sm font-bold text-gray-800">
                授業の5分前には勤務できるよう、準備を整えておいてください。
              </p>
            </div>
          </div>
        )}

        {showInstallBanner && (
          <div className="mb-4 bg-white rounded-2xl border border-orange-200 px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm text-gray-700">
              ホーム画面に追加すると、毎回ブラウザを開かずに済みます。
              <Link
                href="/install"
                className="ml-1 font-medium underline underline-offset-2"
                style={{ color: '#FF7F00' }}
              >
                追加方法を見る
              </Link>
            </div>
            <button
              onClick={() => {
                localStorage.setItem('juku_install_banner_dismissed', '1')
                setShowInstallBanner(false)
              }}
              aria-label="閉じる"
              className="flex-shrink-0 w-7 h-7 rounded-full text-gray-400 hover:text-gray-600 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* ===== 送信済み表示 ===== */}
        {submitted && (
          <>
            <div className="bg-green-50 border border-green-300 rounded-2xl p-5 mb-4 text-center">
              <p className="text-green-700 font-bold text-lg mb-1">✅ 本日の勤怠は送信済みです</p>
              <p className="text-green-600 text-sm">{formatDateLabel(today())}</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3">
              <p className="text-sm font-medium text-gray-500 mb-1">送信内容</p>

              {submittedIndividual && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-gray-700">個別指導</span>
                  <span className="font-bold" style={{ color: '#FF7F00' }}>
                    {submittedIndividual.periods} コマ
                  </span>
                </div>
              )}

              {submittedGroup && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-gray-700">
                    集団授業 {submittedGroup.notes && `（${submittedGroup.notes}）`}
                  </span>
                  <span className="font-bold" style={{ color: '#FF7F00' }}>
                    {submittedGroup.periods} コマ
                  </span>
                </div>
              )}

              {totalExtra > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-gray-700">追加業務時間</span>
                  <span className="font-bold text-gray-600">{totalExtra} 分</span>
                </div>
              )}

              {submittedPrep > 0 && (
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-gray-700">
                    準備時間
                    <span className="ml-2 text-xs text-gray-400">自動付与</span>
                  </span>
                  <span className="font-bold text-gray-600">{submittedPrep} 分</span>
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <span className="text-sm font-medium text-gray-500">合計</span>
                <span className="text-xl font-bold" style={{ color: '#FF7F00' }}>
                  {totalPeriods} コマ
                </span>
              </div>
            </div>

            <p className="text-center text-sm text-gray-400 mt-4">
              修正が必要な場合は管理者にご連絡ください
            </p>

            <Link
              href="/history"
              className="block text-center mt-3 text-sm underline underline-offset-2"
              style={{ color: '#FF7F00' }}
            >
              勤怠履歴を見る
            </Link>
          </>
        )}

        {/* ===== 入力フォーム ===== */}
        {!submitted && step === 'form' && (
          <>
            <h2 className="text-xl font-bold text-gray-800 mb-4">勤怠入力</h2>

            {error && (
              <div className="bg-red-50 border border-red-300 text-red-600 rounded-2xl p-4 mb-4 text-center">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {/* 勤務日（当日固定） */}
              <div className="bg-white rounded-2xl shadow-sm p-5 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-500">勤務日</span>
                <span className="text-base font-bold text-gray-800">{formatDateLabel(today())}</span>
              </div>

              {/* 個別指導 */}
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: '#FF7F00' }}>
                    個別指導
                  </span>
                  <span className="text-sm text-gray-500">担当したコマ数を選択</span>
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPeriods(n)}
                      className="py-4 rounded-xl text-xl font-bold border-2 transition-colors"
                      style={
                        periods === n
                          ? { backgroundColor: '#FF7F00', borderColor: '#FF7F00', color: 'white' }
                          : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="flex items-start justify-between gap-3 mt-1.5">
                  <p className="text-xs text-gray-400">
                    1コマ以上の日は準備時間{PREP_MINUTES_PER_DAY}分が自動で加算されます
                  </p>
                  <p className="text-xs text-gray-400 shrink-0">コマ</p>
                </div>
              </div>

              {/* 集団授業 */}
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: '#CC5500' }}>
                    集団授業
                  </span>
                  <span className="text-sm text-gray-500">担当した時間帯を選択（複数可）</span>
                </div>
                <div className="flex flex-col gap-2">
                  {GROUP_SLOTS.map((slot) => {
                    const isSelected = selectedSlots.includes(slot.label)
                    return (
                      <button
                        key={slot.label}
                        type="button"
                        onClick={() => toggleSlot(slot.label)}
                        className="flex items-center gap-4 px-4 py-3.5 rounded-xl border-2 text-left transition-colors"
                        style={
                          isSelected
                            ? { backgroundColor: '#FFF0E0', borderColor: '#FF7F00' }
                            : { backgroundColor: '#fafafa', borderColor: '#e5e7eb' }
                        }
                      >
                        <span className="text-xl font-bold w-7 text-center shrink-0" style={{ color: isSelected ? '#FF7F00' : '#9ca3af' }}>
                          {slot.label}
                        </span>
                        <span className="text-base tabular-nums" style={{ color: isSelected ? '#CC5500' : '#6b7280' }}>
                          {slot.start} 〜 {slot.end}
                        </span>
                        {isSelected && <span className="ml-auto font-bold" style={{ color: '#FF7F00' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
                {hasGroup && (
                  <p className="text-sm text-center mt-2.5 font-medium" style={{ color: '#FF7F00' }}>
                    {sortedSlots.join('')}（{selectedSlots.length}コマ）を選択中
                  </p>
                )}
              </div>

              {/* 追加業務時間 */}
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <label className="block text-sm font-medium text-gray-500 mb-1.5">
                  追加業務時間
                  <span className="ml-2 text-xs font-normal text-gray-400">授業以外の業務があった場合のみ</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="480"
                    value={extraMinutes}
                    onChange={(e) => setExtraMinutes(e.target.value)}
                    className="w-24 border border-gray-300 rounded-xl px-3 py-3 text-base text-center focus:outline-none focus:border-[#FF7F00]"
                    placeholder="0"
                  />
                  <span className="text-gray-500 text-base">分</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToConfirm}
                className="w-full py-4 rounded-xl text-white font-bold text-lg mt-1"
                style={{ backgroundColor: '#FF7F00' }}
              >
                入力内容を確認する
              </button>
            </div>
          </>
        )}

        {/* ===== 確認画面 ===== */}
        {!submitted && step === 'confirm' && (
          <>
            <h2 className="text-xl font-bold text-gray-800 mb-4">入力内容の確認</h2>
            <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-4">

              <ConfirmRow label="勤務日" value={formatDateLabel(today())} />
              {hasIndividual && <ConfirmRow label="個別指導" value={`${periods} コマ`} />}

              {hasGroup && (
                <div className="flex gap-3 py-3 border-b border-gray-100">
                  <span className="text-sm text-gray-500 w-28 shrink-0 pt-0.5">集団授業</span>
                  <div className="flex flex-col gap-1">
                    {sortedSlots.map((label) => {
                      const slot = GROUP_SLOTS.find((s) => s.label === label)!
                      return (
                        <span key={label} className="text-base text-gray-800 tabular-nums">
                          {label} {slot.start} 〜 {slot.end}
                        </span>
                      )
                    })}
                    <span className="text-sm mt-0.5" style={{ color: '#FF7F00' }}>{selectedSlots.length} コマ</span>
                  </div>
                </div>
              )}

              {extra > 0 && <ConfirmRow label="追加業務時間" value={`${extra} 分`} />}
              {hasIndividual && (
                <ConfirmRow label="準備時間" value={`${PREP_MINUTES_PER_DAY} 分（自動付与）`} />
              )}

              <div className="rounded-xl px-4 py-3 flex justify-between items-center mt-1" style={{ backgroundColor: '#FFF5E6' }}>
                <span className="text-sm font-medium text-gray-600">合計コマ数</span>
                <span className="text-xl font-bold" style={{ color: '#FF7F00' }}>
                  {periods + selectedSlots.length} コマ
                </span>
              </div>

              <div className="flex flex-col gap-3 mt-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-60"
                  style={{ backgroundColor: '#FF7F00' }}
                >
                  {loading ? '送信中...' : 'この内容で送信する'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl font-medium text-base border-2 border-gray-200 text-gray-500 bg-white"
                >
                  修正する
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-3 border-b border-gray-100">
      <span className="text-sm text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-base text-gray-800 font-medium">{value}</span>
    </div>
  )
}
