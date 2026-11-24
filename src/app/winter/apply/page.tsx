'use client'

import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { SUMMER_SLOTS, WINTER_APPLY_PERIOD, WINTER_SPECIAL_COURSE, WINTER_SPECIAL_TOPICS, WINTER_UNAVAILABLE_SLOTS, APPLY_GRADES, isMainSlotOnDate } from '@/types'
import type { ApplyGrade } from '@/types'

// 冬期講習の保護者用申込フォーム。夏期（/summer/apply）とは別ページ。
// 申込は夏期と同じ juku_summer_apply / juku_summer_apply_slots に season='winter' で保存する。

const ORANGE = '#FF7F00'
const SEASON = 'winter'

const SPECIAL_TOPICS = WINTER_SPECIAL_TOPICS
const SPECIAL_PRICE = WINTER_SPECIAL_COURSE.pricePerSlot

const SLOTS = SUMMER_SLOTS.filter(s => WINTER_APPLY_PERIOD.slots.includes(s.slot))
const SLOT_NUMS = SLOTS.map(s => s.slot)
const slotInfo = (slot: number) => SUMMER_SLOTS.find(s => s.slot === slot)!
// メイン（②③）と予備（④⑤）
const isMain = (slot: number) => slot === 2 || slot === 3
const MAIN_LABELS = SLOTS.filter(s => isMain(s.slot)).map(s => s.label).join('・')
const RESERVE_LABELS = SLOTS.filter(s => !isMain(s.slot)).map(s => s.label).join('・')

// 土日の休校日は保護者向けには表示しない（年末年始休みだけ表示する）
const HIDDEN_CLOSED_LABELS = new Set(['休校日'])
const VISIBLE_CLOSED_RANGES = WINTER_APPLY_PERIOD.closedRanges.filter(r => !HIDDEN_CLOSED_LABELS.has(r.label))

const COURSE_STANDARD = '標準コース'
const COURSE_REQUIRED = '必修コース'

const PRICE_TABLE: ReadonlyArray<{ grade: string; standard: number }> = [
  { grade: '小学生', standard: 12080 },
  { grade: '中1', standard: 13730 },
  { grade: '中2', standard: 14280 },
  { grade: '中3', standard: 14830 },
  { grade: '高1', standard: 15980 },
  { grade: '高2', standard: 17580 },
  { grade: '高3', standard: 19230 },
]
// 必修（2回）は標準（4回）の半額
const COURSES = [
  { name: COURSE_REQUIRED, sessions: 2, rate: 0.5 },
  { name: COURSE_STANDARD, sessions: 4, rate: 1 },
] as const

function priceGradeOf(grade: string) {
  return grade.startsWith('小') ? '小学生' : grade
}
function priceOf(grade: string, rate: number) {
  const row = PRICE_TABLE.find(p => p.grade === priceGradeOf(grade))
  return row ? Math.round(row.standard * rate) : 0
}

function fmtMonthDay(ds: string) {
  const [, m, d] = ds.split('-').map(Number)
  const dow = '日月火水木金土'[new Date(ds + 'T00:00:00').getDay()]
  return `${m}/${d}（${dow}）`
}

const SPECIAL_DATE_LABEL = fmtMonthDay(WINTER_SPECIAL_COURSE.date)
const SPECIAL_SLOT_LABELS = WINTER_SPECIAL_COURSE.slots.map(s => slotInfo(s).label).join('・')

// 講師が確保できず選べない日時（例：12/24・25 の④⑤）
const isUnavailable = (date: string, slot: number) =>
  (WINTER_UNAVAILABLE_SLOTS[date] ?? []).includes(slot)
const UNAVAILABLE_NOTE = (() => {
  const dates = Object.keys(WINTER_UNAVAILABLE_SLOTS).sort()
  if (dates.length === 0) return null
  const slots = Array.from(new Set(dates.flatMap(d => WINTER_UNAVAILABLE_SLOTS[d]))).sort((a, b) => a - b)
  return `${dates.map(fmtMonthDay).join('・')}の${slots.map(s => slotInfo(s).label).join('')}は受付していません。`
})()

type Row =
  | { type: 'date'; date: string; dow: number }
  | { type: 'closed'; label: string; rangeLabel: string }

function buildRows(): Row[] {
  const rows: Row[] = []
  const start = new Date(WINTER_APPLY_PERIOD.start + 'T00:00:00')
  const end = new Date(WINTER_APPLY_PERIOD.end + 'T00:00:00')
  const inserted = new Set<string>()
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const closed = WINTER_APPLY_PERIOD.closedRanges.find(r => ds >= r.start && ds <= r.end)
    if (closed) {
      if (!inserted.has(closed.start) && !HIDDEN_CLOSED_LABELS.has(closed.label)) {
        const [, sm, sd] = closed.start.split('-').map(Number)
        const [, em, ed] = closed.end.split('-').map(Number)
        const rangeLabel = sm === em ? `${sm}/${sd}〜${ed}` : `${sm}/${sd}〜${em}/${ed}`
        rows.push({ type: 'closed', label: closed.label, rangeLabel })
        inserted.add(closed.start)
      }
      continue
    }
    if (!WINTER_APPLY_PERIOD.includeWeekends && (dow === 0 || dow === 6)) continue
    rows.push({ type: 'date', date: ds, dow })
  }
  return rows
}

// 中3は特別講座の日時を個別のコマとしては選べない
const isBlockedFor = (grade: string, date: string, slot: number) =>
  grade === WINTER_SPECIAL_COURSE.grade &&
  date === WINTER_SPECIAL_COURSE.date &&
  (WINTER_SPECIAL_COURSE.slots as ReadonlyArray<number>).includes(slot)

export default function WinterApplyPage() {
  const [studentName, setStudentName] = useState('')
  const [grade, setGrade] = useState<ApplyGrade | ''>('')
  const [course, setCourse] = useState('')
  const [special, setSpecial] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => buildRows(), [])
  const isJ3 = grade === WINTER_SPECIAL_COURSE.grade

  const has = (date: string, slot: number) => selected.has(`${date}_${slot}`)

  const toggleCell = (date: string, slot: number) => {
    if (isBlockedFor(grade, date, slot) || isUnavailable(date, slot)) return
    const key = `${date}_${slot}`
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const setSlotsForDate = (date: string, on: boolean) => {
    const next = new Set(selected)
    for (const slot of SLOT_NUMS) {
      if (isBlockedFor(grade, date, slot) || isUnavailable(date, slot)) continue
      const key = `${date}_${slot}`
      if (on) next.add(key)
      else next.delete(key)
    }
    setSelected(next)
  }

  const changeGrade = (g: ApplyGrade) => {
    setGrade(g)
    // 学年が変わったらコースは選び直し（料金が変わるため）
    setCourse('')
    if (g !== WINTER_SPECIAL_COURSE.grade) setSpecial(new Set())
    // 中3になったら、特別講座の日時に入っていた個別のコマを外す
    setSelected(prev => new Set(Array.from(prev).filter(k => {
      const [d, s] = k.split('_')
      return !isBlockedFor(g, d, parseInt(s))
    })))
  }

  const toggleSpecial = (slot: number) => {
    const next = new Set(special)
    if (next.has(slot)) next.delete(slot)
    else next.add(slot)
    setSpecial(next)
  }

  const courseSessions = COURSES.find(c => c.name === course)?.sessions
  const mainCount = Array.from(selected).filter(k => {
    const [d, sl] = k.split('_')
    return isMainSlotOnDate(d, parseInt(sl))
  }).length
  const reserveCount = selected.size - mainCount

  const handleGoConfirm = () => {
    setError(null)
    if (!studentName.trim()) {
      setError('お子さんのお名前を入力してください')
      return
    }
    if (!grade) {
      setError('学年を選んでください')
      return
    }
    if (!course) {
      setError('希望コースを選んでください')
      return
    }
    if (selected.size === 0) {
      setError('希望の日・時間帯を1つ以上選んでください')
      return
    }
    setConfirming(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleFinalSubmit = async () => {
    setError(null)
    setSubmitting(true)
    const specialSlots = isJ3 && special.size > 0 ? Array.from(special).sort((a, b) => a - b) : null
    const { data: applyRow, error: insertErr } = await supabase
      .from('juku_summer_apply')
      .insert({
        season: SEASON,
        student_name: studentName.trim(),
        grade,
        course: course || null,
        special_slots: specialSlots,
        notes: notes.trim() || null,
      })
      .select('id')
      .single()

    if (insertErr || !applyRow) {
      setSubmitting(false)
      setError('送信に失敗しました。もう一度お試しください。')
      return
    }

    const slotRows = Array.from(selected).map(key => {
      const [date, slotStr] = key.split('_')
      return { apply_id: applyRow.id, date, slot: parseInt(slotStr) }
    })
    const { error: slotErr } = await supabase.from('juku_summer_apply_slots').insert(slotRows)

    setSubmitting(false)
    if (slotErr) {
      setError('コマの保存に失敗しました。お手数ですが再度送信をお願いします。')
      return
    }
    setDone(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleReset = () => {
    setStudentName('')
    setGrade('')
    setCourse('')
    setSpecial(new Set())
    setSelected(new Set())
    setNotes('')
    setError(null)
    setDone(false)
    setConfirming(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const header = (title: string, sticky = true) => (
    <header className={`py-4 px-4 shadow-md ${sticky ? 'sticky top-0 z-20' : ''}`} style={{ backgroundColor: ORANGE }}>
      <p className="text-white/80 text-xs">糸島学習塾</p>
      <p className="text-white font-bold text-base">{title}</p>
    </header>
  )

  // ===== 送信完了 =====
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header('冬期講習 お申込みフォーム', false)}
        <main className="max-w-lg mx-auto px-4 py-10 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
            <div
              className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4 text-white text-3xl font-bold"
              style={{ backgroundColor: ORANGE }}
            >
              ✓
            </div>
            <h2 className="text-lg font-bold text-gray-800">送信ありがとうございました</h2>
          </div>
          <div className="rounded-2xl border-2 px-4 py-4 shadow-sm" style={{ borderColor: ORANGE, backgroundColor: '#FFF7ED' }}>
            <h3 className="text-sm font-bold mb-2" style={{ color: '#9A3412' }}>このあとの流れ</h3>
            <p className="text-sm text-gray-800 leading-relaxed">
              塾でお申込み内容を確認のうえ、<span className="font-bold">お席を調整</span>させていただきます。
              確定した<span className="font-bold">お時間帯</span>などを改めてご連絡いたしますので、今しばらくお待ちくださいませ。
            </p>
          </div>
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-gray-500 underline underline-offset-4 active:text-gray-700"
            >
              ← 最初の画面に戻る
            </button>
          </div>
        </main>
      </div>
    )
  }

  // ===== 確認画面 =====
  if (confirming) {
    const byDate = new Map<string, number[]>()
    for (const key of selected) {
      const [date, s] = key.split('_')
      byDate.set(date, [...(byDate.get(date) ?? []), parseInt(s)])
    }
    const groups = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    const coursePrice = COURSES.find(c => c.name === course)
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        {header('入力内容のご確認')}
        <main className="max-w-lg mx-auto px-4 py-5 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm px-4 py-3 text-sm text-gray-700 leading-relaxed">
            以下の内容で送信します。よろしければ画面下の「この内容で送信する」を押してください。
          </div>

          <div className="rounded-2xl border-2 px-4 py-3 shadow-sm" style={{ borderColor: ORANGE, backgroundColor: '#FFF7ED' }}>
            <h3 className="text-sm font-bold mb-1" style={{ color: '#9A3412' }}>送信前にスクリーンショットを</h3>
            <p className="text-xs text-gray-800 leading-relaxed">
              <span className="font-bold">送信ボタンを押す前に、この画面のスクリーンショットを撮っておく</span>と、あとからご家族でご確認いただけます。
            </p>
          </div>

          <section className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
            <div className="px-4 py-3">
              <div className="text-xs text-gray-500 mb-1">お子さんのお名前</div>
              <div className="text-base font-bold text-gray-800">{studentName.trim()}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-gray-500 mb-1">学年</div>
              <div className="text-base font-bold text-gray-800">{grade}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-gray-500 mb-1">希望コース</div>
              <div className="text-base font-bold" style={{ color: ORANGE }}>
                {course}
                {coursePrice && (
                  <span className="ml-2 text-sm text-gray-700 tabular-nums">
                    {coursePrice.sessions}回・{priceOf(grade, coursePrice.rate).toLocaleString()}円
                  </span>
                )}
              </div>
            </div>
            {isJ3 && (
              <div className="px-4 py-3">
                <div className="text-xs text-gray-500 mb-1">中3特別講座（{SPECIAL_DATE_LABEL}）</div>
                {special.size > 0 ? (
                  <div className="text-base font-bold" style={{ color: ORANGE }}>
                    {Array.from(special).sort((a, b) => a - b).map(s => {
                      const info = slotInfo(s)
                      return `${SPECIAL_TOPICS[s].subject}の${SPECIAL_TOPICS[s].theme}（${info.start}〜${info.end}）`
                    }).join(' ／ ')}
                    <span className="ml-2 text-sm text-gray-700 tabular-nums">
                      {special.size}講座・{(special.size * SPECIAL_PRICE).toLocaleString()}円（税込・教材費込み）
                    </span>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">受講しない</div>
                )}
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-sm font-bold text-gray-800">希望の日・時間帯</div>
              <div className="text-xs text-gray-500">
                メイン {mainCount}・予備 {reserveCount}（合計 <span className="font-bold text-gray-800">{selected.size}</span> コマ）
              </div>
            </div>
            <div className="space-y-3">
              {groups.map(([date, slots]) => (
                <div key={date} className="pb-2 border-b border-gray-100 last:border-b-0 last:pb-0">
                  <div className="text-sm font-bold tabular-nums mb-1.5 text-gray-700">{fmtMonthDay(date)}</div>
                  <div className="space-y-1 pl-1">
                    {slots.sort((a, b) => a - b).map(s => {
                      const info = slotInfo(s)
                      const main = isMainSlotOnDate(date, s)
                      return (
                        <div key={s} className="flex items-center gap-2 text-sm">
                          <span
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md font-bold text-sm shrink-0"
                            style={main
                              ? { backgroundColor: ORANGE, color: 'white' }
                              : { backgroundColor: 'white', color: '#6b7280', border: '1px solid #d1d5db' }}
                          >
                            {info.label}
                          </span>
                          <span className="tabular-nums font-semibold text-gray-800">{info.start}〜{info.end}</span>
                          <span
                            className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                            style={main
                              ? { backgroundColor: ORANGE, color: 'white' }
                              : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}
                          >
                            {main ? 'メイン' : '予備'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
            <div className="text-xs text-gray-500 mb-1">ご要望・受けたい科目など</div>
            {notes.trim() ? (
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{notes.trim()}</div>
            ) : (
              <div className="text-sm text-gray-400">（記入なし）</div>
            )}
          </section>

          <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 text-xs text-gray-700 leading-relaxed space-y-1">
            <div>普段の通塾曜日・時間帯は<span className="font-bold">そのまま継続</span>します。</div>
            <div>
              冬期講習は通常授業に<span className="font-bold">追加で受講</span>するもので、料金は<span className="font-bold">1月の月謝に加算</span>されます。
            </div>
            <div className="text-gray-500">※正式な料金・受講回数は、お申込み内容を確認のうえ別途ご案内いたします。</div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
          )}
        </main>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
          <div className="max-w-lg mx-auto flex gap-2">
            <button
              type="button"
              onClick={() => { setConfirming(false); setError(null) }}
              disabled={submitting}
              className="w-1/3 py-3.5 rounded-xl font-bold text-base border-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
              style={{ borderColor: '#e5e7eb', color: '#4b5563', backgroundColor: 'white' }}
            >
              修正する
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={submitting}
              className="flex-1 py-3.5 rounded-xl text-white font-bold text-base shadow-md disabled:opacity-60 active:scale-[0.98] transition-transform"
              style={{ backgroundColor: ORANGE }}
            >
              {submitting ? '送信中…' : 'この内容で送信する'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 入力画面 =====
  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {header('冬期講習 お申込みフォーム')}

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* 申込制 */}
        <section className="rounded-2xl shadow-sm px-4 py-4 border-2" style={{ backgroundColor: '#FFF7ED', borderColor: ORANGE }}>
          <h2 className="text-base font-bold mb-1.5" style={{ color: '#9A3412' }}>冬期講習は申込制です</h2>
          <p className="text-sm text-gray-800 leading-relaxed">
            このフォームから<span className="font-bold">お申込みいただいた方のみ受講</span>できます。
            お申込みがない場合は通常授業のみとなります。
          </p>
        </section>

        {/* はじめにお読みください */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">はじめにお読みください</h2>
          <ol className="text-sm text-gray-800 leading-relaxed space-y-2 list-decimal pl-5">
            <li>普段の<span className="font-bold">通塾曜日・時間帯はそのまま</span>続きます。</li>
            <li>冬期講習は、通常授業に<span className="font-bold">「追加で」受講する特別授業</span>です。</li>
            <li>受講した分の料金が、<span className="font-bold">1月の月謝に加算</span>されます（金額は下の表をご参照ください）。</li>
          </ol>
        </section>

        {/* 実施日程とお休み */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">実施日程</h2>
          <p className="text-sm text-gray-800 leading-relaxed">
            {fmtMonthDay(WINTER_APPLY_PERIOD.start)}〜{fmtMonthDay(WINTER_APPLY_PERIOD.end)}
          </p>
          <div className="mt-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-800 space-y-1">
            {VISIBLE_CLOSED_RANGES.map(r => (
              <div key={r.start}>
                <span className="font-bold">{fmtMonthDay(r.start)}〜{fmtMonthDay(r.end)}</span>
                <span className="ml-1">は{r.label}です。</span>
              </div>
            ))}
          </div>
        </section>

        {/* 中3特別講座のご案内（概要のみ。詳細は中3を選ぶと表示） */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded text-white" style={{ backgroundColor: ORANGE }}>中3生</span>
            <h2 className="text-sm font-bold text-gray-800">受験生向け 特別講座</h2>
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">
            {SPECIAL_DATE_LABEL}に、入試の「書く」問題（作文・英作文）に絞った講座を行います。
            下の「学年」で中3を選ぶと、内容とお申込み欄が表示されます。
          </p>
        </section>

        {/* 申込順のお願い */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">お申込みのお願い</h2>
          <div className="text-sm text-gray-800 leading-relaxed space-y-2">
            <p>
              <span className="font-bold">お申込みいただいた順にお席をご用意</span>します。
              ご希望の日程でお席を確保しやすいよう、<span className="font-bold">できるだけ早めに</span>お申込みください。
            </p>
            <p className="rounded-xl px-3 py-2.5 text-[13px] bg-gray-50 border border-gray-200">
              <span className="font-bold">候補日はできるだけたくさんお選びください。</span>
              候補が多いほど、ご希望に沿った日程でお席を確保しやすくなります。
            </p>
          </div>
        </section>

        {/* 料金 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">料金について</h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 leading-relaxed mb-3 text-center">
            <span className="font-bold">1月のお支払い金額</span><br />
            ＝ 通常の月謝 ＋
            <span className="font-bold ml-1" style={{ color: ORANGE }}>冬期講習の料金（下表）</span>
          </div>
          <table className="w-full text-sm border border-gray-200 rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-orange-50 text-xs text-gray-600">
                <th className="px-3 py-2 text-left font-bold">学年</th>
                <th className="px-3 py-2 text-right font-bold">必修（2回）</th>
                <th className="px-3 py-2 text-right font-bold">標準（4回）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PRICE_TABLE.map(p => (
                <tr key={p.grade}>
                  <td className="px-3 py-2 font-bold text-gray-700">{p.grade}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: ORANGE }}>{Math.round(p.standard / 2).toLocaleString()}円</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: ORANGE }}>{p.standard.toLocaleString()}円</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
            ※小学生は学年に関わらず同額です。<br />
            ※中3特別講座は1講座 {SPECIAL_PRICE.toLocaleString()}円（税込・教材費込み）です。<br />
            ※正式な金額・受講回数は、お申込み内容を確認のうえ別途ご案内いたします。
          </p>
        </section>

        {/* お名前 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            お子さんのお名前
            <span className="ml-2 text-xs font-normal" style={{ color: ORANGE }}>必須</span>
          </label>
          <input
            type="text"
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="例：糸島 太郎"
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-orange-400"
          />
        </section>

        {/* 学年 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            学年
            <span className="ml-2 text-xs font-normal" style={{ color: ORANGE }}>必須</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {APPLY_GRADES.map(g => {
              const on = grade === g
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => changeGrade(g)}
                  className="py-2.5 rounded-lg border-2 text-sm font-bold transition-colors active:scale-95"
                  style={on
                    ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                    : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }}
                >
                  {g}
                </button>
              )
            })}
          </div>
        </section>

        {/* 中3特別講座の申込 */}
        {isJ3 && (
          <section className="bg-white rounded-2xl shadow-sm px-4 py-4 border-2" style={{ borderColor: ORANGE }}>
            <label className="block text-sm font-bold text-gray-800 mb-1">
              中3特別講座<span className="ml-2 font-normal text-gray-600">{SPECIAL_DATE_LABEL}</span>
            </label>
            <p className="text-xs text-gray-700 mb-3 leading-relaxed">
              入試で差がつきやすい「書く」問題に絞った講座です。白紙で終わらせず、点につなげる書き方を練習します。
              公立高校入試向けですが、私立志望の方にも役立つ内容です。
            </p>
            <p className="text-xs font-bold text-gray-800 mb-2">受けたい講座をタップしてください（両方でも、片方だけでもかまいません）</p>
            <div className="grid grid-cols-2 gap-2">
              {WINTER_SPECIAL_COURSE.slots.map(s => {
                const info = slotInfo(s)
                const on = special.has(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSpecial(s)}
                    className="py-3 rounded-xl border-2 text-sm font-bold transition-colors active:scale-[0.98]"
                    style={on
                      ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                      : { backgroundColor: 'white', borderColor: '#FDBA74', color: '#C2410C' }}
                  >
                    <span className="block text-base">{on ? '✓ ' : ''}{SPECIAL_TOPICS[s].subject}の{SPECIAL_TOPICS[s].theme}</span>
                    <span className="block text-[11px] font-normal tabular-nums">{info.start}〜{info.end}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
              1講座 {SPECIAL_PRICE.toLocaleString()}円（税込・教材費込み）。冬期講習のコースの回数には含まれません。<br />
              ※少人数制で行います。<br />
              ※講座の内容は変更となる場合があります。
            </p>
          </section>
        )}

        {/* コース */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            希望コース
            <span className="ml-2 text-xs font-normal" style={{ color: ORANGE }}>必須</span>
          </label>
          {!grade ? (
            <p className="text-xs text-gray-500">先に学年をお選びください。</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {COURSES.map(c => {
                const on = course === c.name
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setCourse(c.name)}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-bold transition-colors active:scale-[0.98]"
                    style={on
                      ? { backgroundColor: '#FFF7ED', borderColor: ORANGE, color: ORANGE }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }}
                  >
                    <span className="flex items-baseline gap-2">
                      <span>{c.name}</span>
                      <span className="text-[11px] font-normal text-gray-500">{c.sessions}回</span>
                    </span>
                    <span className="tabular-nums" style={{ color: on ? ORANGE : '#374151' }}>
                      {priceOf(grade, c.rate).toLocaleString()}円
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* 希望の日・時間帯 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            希望の日・時間帯
            <span className="ml-2 text-xs font-normal" style={{ color: ORANGE }}>必須</span>
          </label>
          <p className="text-xs text-gray-700 mb-1 leading-relaxed">
            来られそうな枠を<span className="font-bold">できるだけたくさん</span>タップしてください。
            {courseSessions && (
              <> {course}は{courseSessions}回なので、<span className="font-bold">{courseSessions}コマより多め</span>にお選びいただくと調整しやすくなります。</>
            )}
          </p>
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">「全○」ボタンでその日のコマをまとめて選べます。</p>

          <div className="rounded-xl px-3 py-3 mb-3 border-2 text-sm leading-relaxed" style={{ backgroundColor: '#FFF7ED', borderColor: ORANGE }}>
            <p className="text-gray-800">
              冬期講習は主に <span className="font-bold" style={{ color: ORANGE }}>{MAIN_LABELS}の時間帯（メイン）</span> で行います。
            </p>
            <p className="text-xs text-gray-700 mt-1.5 leading-relaxed">
              お席の都合がつかない場合に <span className="font-bold">{RESERVE_LABELS}（予備）を組み合わせて</span> ご調整することがあります。
              予備にも来られそうな枠があれば、お席のご用意がしやすくなります。
            </p>
          </div>
          {UNAVAILABLE_NOTE && (
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">※{UNAVAILABLE_NOTE}（表では × で表示）</p>
          )}
          {isJ3 && (
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              ※{SPECIAL_DATE_LABEL}の{SPECIAL_SLOT_LABELS}は中3特別講座の時間のため、ここでは選べません。
            </p>
          )}

          <div className="rounded-xl px-3 py-2 mb-3 border border-gray-200 space-y-1 text-xs text-gray-700">
            {SLOTS.map(s => {
              const main = isMain(s.slot)
              return (
                <div key={s.slot} className="flex items-center gap-2 tabular-nums">
                  <span className="font-bold w-5 text-center" style={{ color: main ? ORANGE : '#9ca3af' }}>{s.label}</span>
                  <span className={main ? 'text-gray-800 font-semibold' : 'text-gray-500'}>{s.start}〜{s.end}</span>
                  <span
                    className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                    style={main
                      ? { backgroundColor: ORANGE, color: 'white' }
                      : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}
                  >
                    {main ? 'メイン' : '予備'}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-stretch bg-gray-50 px-2 py-2 text-[11px] font-bold text-gray-600 border-b border-gray-200">
              <div className="w-16 shrink-0 pl-1 flex items-center">日付</div>
              {SLOTS.map(s => {
                const main = isMain(s.slot)
                return (
                  <div
                    key={s.slot}
                    className="flex-1 flex flex-col items-center justify-end gap-0.5 py-0.5"
                    style={{ backgroundColor: main ? '#FFF7ED' : undefined }}
                  >
                    <span style={{ color: main ? ORANGE : '#9ca3af', fontSize: main ? '16px' : '11px', lineHeight: 1 }}>{s.label}</span>
                    <span
                      style={main
                        ? { backgroundColor: ORANGE, color: 'white', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', lineHeight: 1 }
                        : { backgroundColor: '#f3f4f6', color: '#9ca3af', padding: '1px 3px', borderRadius: '3px', fontSize: '8px', lineHeight: 1 }}
                    >
                      {main ? 'メイン' : '予備'}
                    </span>
                  </div>
                )
              })}
              <div className="w-11 shrink-0 text-center text-[9px] text-gray-500 flex items-center justify-center">一括</div>
            </div>

            {rows.map((row, idx) => {
              if (row.type === 'closed') {
                return (
                  <div key={`closed-${idx}`} className="py-2.5 bg-gray-100 border-y border-gray-200 text-[11px] font-bold text-gray-500 text-center">
                    ━ {row.label} {row.rangeLabel} ━
                  </div>
                )
              }
              const [, m, d] = row.date.split('-').map(Number)
              const dowColor = row.dow === 0 ? '#ef4444' : row.dow === 6 ? '#3b82f6' : '#374151'
              const selectable = SLOT_NUMS.filter(s => !isBlockedFor(grade, row.date, s) && !isUnavailable(row.date, s))
              const rowAllOn = selectable.length > 0 && selectable.every(s => has(row.date, s))
              return (
                <div key={row.date} className="flex items-stretch px-2 border-b border-gray-100 last:border-b-0">
                  <div className="w-16 shrink-0 pl-1 text-xs tabular-nums flex flex-col justify-center" style={{ color: dowColor }}>
                    <div className="font-semibold leading-tight">{m}/{d}</div>
                    <div className="text-[10px] leading-tight">({'日月火水木金土'[row.dow]})</div>
                  </div>
                  {SLOTS.map(s => {
                    const blocked = isBlockedFor(grade, row.date, s.slot)
                    const unavailable = isUnavailable(row.date, s.slot)
                    const on = has(row.date, s.slot)
                    const main = isMainSlotOnDate(row.date, s.slot)
                    return (
                      <div key={s.slot} className="flex-1 flex justify-center items-center py-1.5" style={{ backgroundColor: main ? '#FFFBF5' : undefined }}>
                        {blocked ? (
                          <div
                            className="w-11 h-11 rounded-lg flex items-center justify-center text-[10px] font-bold leading-tight text-center"
                            style={{ backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px dashed #d1d5db' }}
                          >
                            特別<br />講座
                          </div>
                        ) : unavailable ? (
                          <div
                            className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold"
                            style={{ backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                            aria-label={`${m}/${d} ${s.label} 受付なし`}
                          >
                            ×
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleCell(row.date, s.slot)}
                            className={`${main ? 'w-11 h-11 rounded-lg border-2' : 'w-7 h-7 rounded-md border'} flex items-center justify-center transition-colors active:scale-95`}
                            style={main
                              ? on
                                ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                                : { backgroundColor: 'white', borderColor: '#FDBA74', color: '#FB923C' }
                              : on
                                ? { backgroundColor: '#9ca3af', borderColor: '#9ca3af', color: 'white' }
                                : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#d1d5db' }}
                            aria-label={`${m}/${d} ${s.label} ${main ? 'メイン' : '予備'} ${on ? '解除' : '選択'}`}
                          >
                            {on
                              ? <span style={{ fontSize: main ? '20px' : '12px', fontWeight: 700, lineHeight: 1 }}>✓</span>
                              : <span style={{ fontSize: main ? '12px' : '10px', lineHeight: 1 }}>・</span>}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <div className="w-11 shrink-0 flex justify-center items-center">
                    {selectable.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSlotsForDate(row.date, !rowAllOn)}
                        className="text-[10px] font-bold px-1.5 py-1 rounded-md border"
                        style={rowAllOn
                          ? { color: '#9ca3af', borderColor: '#e5e7eb', backgroundColor: 'white' }
                          : { color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
                      >
                        {rowAllOn ? '解除' : '全○'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-500 mt-3 text-right">
            選択中：
            <span className="font-bold ml-1" style={{ color: ORANGE }}>メイン {mainCount}</span>
            <span className="mx-1">/</span>
            <span className="font-bold text-gray-600">予備 {reserveCount}</span>
            <span className="ml-2 text-[11px] text-gray-500">（合計 {selected.size} コマ）</span>
          </p>
        </section>

        {/* 要望 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            ご要望・受けたい科目など
            <span className="ml-2 text-xs font-normal text-gray-400">任意</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="例：数学を中心に受けたいです。"
            rows={5}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 resize-y"
          />
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={handleGoConfirm}
            className="w-full py-3.5 rounded-xl text-white font-bold text-base shadow-md active:scale-[0.98] transition-transform"
            style={{ backgroundColor: ORANGE }}
          >
            入力内容を確認する
          </button>
        </div>
      </div>
    </div>
  )
}
