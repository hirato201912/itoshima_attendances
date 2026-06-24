'use client'

import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { SUMMER_SLOTS, SUMMER_APPLY_PERIOD, APPLY_GRADES } from '@/types'
import type { ApplyGrade } from '@/types'

const ORANGE = '#FF7F00'

type Row =
  | { type: 'date'; date: string; dow: number }
  | { type: 'closed'; label: string; rangeLabel: string }

function findClosedRange(dateStr: string) {
  return SUMMER_APPLY_PERIOD.closedRanges.find(r => dateStr >= r.start && dateStr <= r.end)
}

function buildRows(): Row[] {
  const rows: Row[] = []
  const start = new Date(SUMMER_APPLY_PERIOD.start + 'T00:00:00')
  const end = new Date(SUMMER_APPLY_PERIOD.end + 'T00:00:00')
  const insertedRanges = new Set<string>()
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const ds = `${y}-${m}-${day}`
    const closed = findClosedRange(ds)
    if (closed) {
      if (!insertedRanges.has(closed.start)) {
        const sm = parseInt(closed.start.split('-')[1])
        const sd = parseInt(closed.start.split('-')[2])
        const em = parseInt(closed.end.split('-')[1])
        const ed = parseInt(closed.end.split('-')[2])
        const rangeLabel = (closed.start as string) === (closed.end as string)
          ? `${sm}/${sd}`
          : sm === em
          ? `${sm}/${sd}〜${ed}`
          : `${sm}/${sd}〜${em}/${ed}`
        rows.push({ type: 'closed', label: closed.label, rangeLabel })
        insertedRanges.add(closed.start)
      }
      continue
    }
    rows.push({ type: 'date', date: ds, dow })
  }
  return rows
}

const COURSE_NAMES: Record<number, string> = {
  4: '必修コース',
  8: '標準コース',
  12: '充実コース',
}

const MAIN_SLOTS = new Set<number>([2, 3])
const isMainSlot = (slot: number) => MAIN_SLOTS.has(slot)
const ALL_SLOT_NUMS = SUMMER_SLOTS.map(s => s.slot)

const PRICE_TABLE: ReadonlyArray<{
  grade: string
  items: ReadonlyArray<{ amount: number; sessions: number }>
}> = [
  { grade: '小学生', items: [
    { amount: 12080, sessions: 4 },
    { amount: 23410, sessions: 8 },
  ]},
  { grade: '中1', items: [
    { amount: 13730, sessions: 4 },
    { amount: 25280, sessions: 8 },
  ]},
  { grade: '中2', items: [
    { amount: 14280, sessions: 4 },
    { amount: 25830, sessions: 8 },
  ]},
  { grade: '中3', items: [
    { amount: 14830, sessions: 4 },
    { amount: 26930, sessions: 8 },
    { amount: 44490, sessions: 12 },
  ]},
  { grade: '高1', items: [
    { amount: 15930, sessions: 4 },
    { amount: 29130, sessions: 8 },
  ]},
  { grade: '高2', items: [
    { amount: 17580, sessions: 4 },
    { amount: 31330, sessions: 8 },
  ]},
  { grade: '高3', items: [
    { amount: 19230, sessions: 4 },
    { amount: 33530, sessions: 8 },
  ]},
]

// 学年→申込可能なコース（受講回数）一覧。中3のみ充実コース(12回)あり
const COURSE_OPTIONS_BY_GRADE: Record<string, ReadonlyArray<{ sessions: number; amount: number }>> = {}
for (const g of PRICE_TABLE) {
  // PRICE_TABLEのgrade表記は「小学生/中1/中2/中3/高1/高2/高3」
  // 申込フォームの学年（小1〜小6/中1〜中3/高1〜高3）に対応するキーへマッピング
  if (g.grade === '小学生') {
    for (const k of ['小1', '小2', '小3', '小4', '小5', '小6']) {
      COURSE_OPTIONS_BY_GRADE[k] = g.items
    }
  } else {
    COURSE_OPTIONS_BY_GRADE[g.grade] = g.items
  }
}

const COURSE_CONSULT = '相談して決めたい'

type GroupedSlot = { date: string; dow: number; slots: number[] }

function groupSelectedByDate(selected: Set<string>): GroupedSlot[] {
  const map = new Map<string, number[]>()
  for (const key of selected) {
    const [date, slotStr] = key.split('_')
    const arr = map.get(date) ?? []
    arr.push(parseInt(slotStr))
    map.set(date, arr)
  }
  const result: GroupedSlot[] = []
  for (const [date, slots] of map) {
    slots.sort((a, b) => a - b)
    const d = new Date(date + 'T00:00:00')
    result.push({ date, dow: d.getDay(), slots })
  }
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

export default function SummerApplyPage() {
  const [studentName, setStudentName] = useState('')
  const [grade, setGrade] = useState<ApplyGrade | ''>('')
  const [course, setCourse] = useState<string>('') // '必修' | '標準' | '充実' | '相談して決めたい' | ''
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => buildRows(), [])

  const has = (date: string, slot: number) => selected.has(`${date}_${slot}`)

  const toggleCell = (date: string, slot: number) => {
    const key = `${date}_${slot}`
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const setSlotsForDate = (date: string, slots: number[], on: boolean) => {
    const next = new Set(selected)
    for (const slot of slots) {
      const key = `${date}_${slot}`
      if (on) next.add(key)
      else next.delete(key)
    }
    setSelected(next)
  }

  const mainCount = useMemo(
    () => Array.from(selected).filter(k => isMainSlot(parseInt(k.split('_')[1]))).length,
    [selected]
  )
  const reserveCount = selected.size - mainCount

  const handleGoConfirm = () => {
    setError(null)
    const name = studentName.trim()
    if (!name) {
      setError('お子さんのお名前を入力してください')
      return
    }
    if (!grade) {
      setError('学年を選んでください')
      return
    }
    if (selected.size === 0) {
      setError('希望のコマを1つ以上選んでください')
      return
    }
    setConfirming(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBackToEdit = () => {
    setConfirming(false)
    setError(null)
  }

  const handleFinalSubmit = async () => {
    setError(null)
    const name = studentName.trim()

    setSubmitting(true)
    const { data: applyRow, error: insertErr } = await supabase
      .from('juku_summer_apply')
      .insert({
        student_name: name,
        grade,
        course: course || null,
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

    const { error: slotErr } = await supabase
      .from('juku_summer_apply_slots')
      .insert(slotRows)

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
    setSelected(new Set())
    setNotes('')
    setError(null)
    setDone(false)
    setConfirming(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (confirming && !done) {
    const groups = groupSelectedByDate(selected)
    const slotInfoMap: Record<number, { label: string; start: string; end: string }> = {}
    for (const s of SUMMER_SLOTS) slotInfoMap[s.slot] = { label: s.label, start: s.start, end: s.end }
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        <header
          className="py-4 px-4 shadow-md sticky top-0 z-20"
          style={{ backgroundColor: ORANGE }}
        >
          <p className="text-white/80 text-xs">糸島学習塾</p>
          <p className="text-white font-bold text-base">入力内容のご確認</p>
        </header>

        <main className="max-w-lg mx-auto px-4 py-5 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm px-4 py-3 text-sm text-gray-700 leading-relaxed">
            以下の内容で送信します。よろしければ画面下の「この内容で送信する」を押してください。
          </div>

          {/* スクリーンショットのお願い */}
          <div
            className="rounded-2xl border-2 px-4 py-3 shadow-sm"
            style={{ borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: ORANGE, color: 'white' }}
              >
                お願い
              </span>
              <h3 className="text-sm font-bold" style={{ color: '#9A3412' }}>
                送信前にスクリーンショットを
              </h3>
            </div>
            <p className="text-xs text-gray-800 leading-relaxed">
              <span className="font-bold">送信ボタンを押す前に、念のためこの画面のスクリーンショットを撮っておく</span>と、あとからご家族でご確認いただけて安心です。
            </p>
          </div>

          {/* お名前・学年・コース */}
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
              {course ? (
                <div className="text-base font-bold" style={{ color: ORANGE }}>{course}{course !== COURSE_CONSULT ? 'コース' : ''}</div>
              ) : (
                <div className="text-sm text-gray-400">（未選択：塾からご提案します）</div>
              )}
            </div>
          </section>

          {/* 希望コマ */}
          <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-sm font-bold text-gray-800">希望の日・時間帯</div>
              <div className="text-xs text-gray-500">
                合計 <span className="font-bold text-gray-800">{selected.size}</span> コマ
              </div>
            </div>
            <div className="flex items-center gap-3 mb-3 text-[11px] text-gray-600">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: ORANGE }}></span>
                メイン {mainCount}コマ
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: '#f3f4f6' }}></span>
                予備 {reserveCount}コマ
              </span>
            </div>
            <div className="space-y-3">
              {groups.map(g => {
                const dayLabel = '日月火水木金土'[g.dow]
                const dayNum = parseInt(g.date.split('-')[2])
                const month = parseInt(g.date.split('-')[1])
                const dowColor = g.dow === 0 ? '#ef4444' : g.dow === 6 ? '#3b82f6' : '#374151'
                return (
                  <div key={g.date} className="pb-2 border-b border-gray-100 last:border-b-0 last:pb-0">
                    <div className="text-sm tabular-nums mb-1.5" style={{ color: dowColor }}>
                      <span className="font-bold">{month}/{dayNum}</span>
                      <span className="ml-1 text-xs">({dayLabel})</span>
                    </div>
                    <div className="space-y-1 pl-1">
                      {g.slots.map(slot => {
                        const main = isMainSlot(slot)
                        const info = slotInfoMap[slot]
                        return (
                          <div key={slot} className="flex items-center gap-2 text-sm">
                            <span
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md font-bold text-sm shrink-0"
                              style={
                                main
                                  ? { backgroundColor: ORANGE, color: 'white' }
                                  : { backgroundColor: 'white', color: '#6b7280', border: '1px solid #d1d5db' }
                              }
                            >
                              {info.label}
                            </span>
                            <span className="tabular-nums font-semibold text-gray-800">
                              {info.start}〜{info.end}
                            </span>
                            <span
                              className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                              style={
                                main
                                  ? { backgroundColor: ORANGE, color: 'white' }
                                  : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }
                              }
                            >
                              {main ? 'メイン' : '予備'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 要望 */}
          <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
            <div className="text-xs text-gray-500 mb-1">ご要望・受けたい科目など</div>
            {notes.trim() ? (
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{notes.trim()}</div>
            ) : (
              <div className="text-sm text-gray-400">（記入なし）</div>
            )}
          </section>

          {/* 料金・通常授業との関係の再案内 */}
          <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 text-xs text-gray-700 leading-relaxed space-y-1">
            <div>
              普段の通塾曜日・時間帯は<span className="font-bold">そのまま継続</span>します。
            </div>
            <div>
              夏期講習は通常授業に<span className="font-bold">追加で受講</span>するもので、料金は<span className="font-bold">8月の月謝に加算</span>されます。
            </div>
            <div className="text-gray-500">
              ※正式な料金・受講回数は、お申込み内容を確認のうえ別途ご案内いたします。
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </main>

        {/* 下部固定ボタン */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30">
          <div className="max-w-lg mx-auto flex gap-2">
            <button
              type="button"
              onClick={handleBackToEdit}
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

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header
          className="py-4 px-4 shadow-md"
          style={{ backgroundColor: ORANGE }}
        >
          <p className="text-white/80 text-xs">糸島学習塾</p>
          <p className="text-white font-bold text-base">夏期講習 お申込みフォーム</p>
        </header>
        <main className="max-w-lg mx-auto px-4 py-10 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
            <div
              className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4 text-white text-3xl font-bold"
              style={{ backgroundColor: ORANGE }}
            >
              ✓
            </div>
            <h2 className="text-lg font-bold text-gray-800">
              送信ありがとうございました
            </h2>
          </div>

          {/* このあとの流れ */}
          <div
            className="rounded-2xl border-2 px-4 py-4 shadow-sm"
            style={{ borderColor: ORANGE, backgroundColor: '#FFF7ED' }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: ORANGE, color: 'white' }}
              >
                お知らせ
              </span>
              <h3 className="text-sm font-bold" style={{ color: '#9A3412' }}>
                このあとの流れ
              </h3>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">
              塾でお申込み内容を確認のうえ、<span className="font-bold">お席を調整</span>させていただきます。
              確定した<span className="font-bold">お時間帯</span>などを改めてご連絡いたしますので、今しばらくお待ちくださいませ。
            </p>
          </div>

          {/* 最初の画面に戻るリンク */}
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

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* ヘッダー */}
      <header
        className="py-4 px-4 shadow-md sticky top-0 z-20"
        style={{ backgroundColor: ORANGE }}
      >
        <p className="text-white/80 text-xs">糸島学習塾</p>
        <p className="text-white font-bold text-base">夏期講習 お申込みフォーム</p>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* 夏期講習について（最初に必ず読んでほしい案内） */}
        <section
          className="rounded-2xl shadow-sm px-4 py-4 border-2"
          style={{ backgroundColor: '#FFF7ED', borderColor: ORANGE }}
        >
          <h2 className="text-sm font-bold mb-2" style={{ color: '#9A3412' }}>
            はじめにお読みください
          </h2>
          <ol className="text-sm text-gray-800 leading-relaxed space-y-2 list-decimal pl-5">
            <li>
              普段の<span className="font-bold">通塾曜日・時間帯はそのまま</span>続きます。8月もこれまで通り通塾していただけます。
            </li>
            <li>
              夏期講習は、通常授業に<span className="font-bold">「追加で」受講する特別授業</span>です。
            </li>
            <li>
              受講した分の料金が、<span className="font-bold">8月の月謝に加算</span>されます（金額は下の表をご参照ください）。
            </li>
          </ol>
        </section>

        {/* お申込みのお願い（申込順・候補多め） */}
        <section
          className="rounded-2xl shadow-sm px-4 py-4 border-2"
          style={{ backgroundColor: '#FFFBEB', borderColor: '#F59E0B' }}
        >
          <h2 className="text-sm font-bold mb-2" style={{ color: '#92400E' }}>
            お申込みのお願い
          </h2>
          <div className="text-sm text-gray-800 leading-relaxed space-y-2">
            <p>
              申込期限は特に設けておりませんが、<span className="font-bold">お申込みいただいた順にお席をご用意</span>します。
              ご希望の日程でお席を確保しやすいよう、<span className="font-bold">できるだけ早めに</span>お申込みください。
            </p>
            <div className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed bg-white border border-amber-200">
              <span className="font-bold text-gray-800">候補日はできるだけたくさんお選びください。</span>
              <span className="block font-normal text-xs mt-1 text-gray-600">
                候補が多いほどお席のご用意がしやすくなり、ご希望に沿った日程をご提案できる可能性が高まります。
              </span>
            </div>
          </div>
        </section>

        {/* 入力の流れ */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3 text-sm text-gray-700 leading-relaxed">
          来られそうな日・時間帯をお選びいただき、最後に「入力内容を確認する」ボタンを押してください。
          いただいた希望をもとに、塾から日程をご提案します。
        </div>

        {/* 料金について */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">
            料金について
          </h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 leading-relaxed mb-3 text-center">
            <span className="font-bold">8月のお支払い金額</span><br />
            ＝ 通常の月謝 ＋
            <span className="font-bold ml-1" style={{ color: ORANGE }}>夏期講習の料金（下表）</span>
          </div>

          {/* コース名の凡例 */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3 text-[11px] text-gray-700 leading-relaxed">
            <span className="font-bold">コース名：</span>
            <span className="ml-1">4回＝<span className="font-bold">必修</span></span>
            <span className="ml-2">8回＝<span className="font-bold">標準</span></span>
            <span className="ml-2">12回＝<span className="font-bold">充実</span></span>
          </div>

          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {PRICE_TABLE.map(g => (
              <div key={g.grade} className="px-3 py-2.5">
                <div className="text-sm font-bold text-gray-700 mb-1.5">
                  {g.grade}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 pl-1">
                  {g.items.map(it => (
                    <div key={it.sessions} className="flex flex-col tabular-nums">
                      <span className="text-[10px] text-gray-500 leading-tight">
                        {COURSE_NAMES[it.sessions]}（{it.sessions}回）
                      </span>
                      <span className="text-sm font-bold leading-tight" style={{ color: ORANGE }}>
                        {it.amount.toLocaleString()}円
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
            ※小学生は学年に関わらず同額です。<br />
            ※正式な金額・受講回数は、お申込み内容を確認のうえ別途ご案内いたします。
          </p>
        </section>

        {/* 1. お子さんの名前 */}
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

        {/* 2. 学年 */}
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
                  onClick={() => {
                    setGrade(g)
                    // 学年が変わったらコース選択はリセット（料金体系が変わるため）
                    setCourse('')
                  }}
                  className="py-2.5 rounded-lg border-2 text-sm font-bold transition-colors active:scale-95"
                  style={
                    on
                      ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                  }
                >
                  {g}
                </button>
              )
            })}
          </div>
        </section>

        {/* 2.5 希望コース */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            希望コース
            <span className="ml-2 text-xs font-normal text-gray-400">任意</span>
          </label>
          {!grade ? (
            <p className="text-xs text-gray-500">
              先に学年をお選びください。
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                ご希望のコースをお選びください。お決まりでない場合は「{COURSE_CONSULT}」を選んでいただければ、塾からご提案します。
              </p>
              <div className="grid grid-cols-1 gap-2">
                {(COURSE_OPTIONS_BY_GRADE[grade] ?? []).map(opt => {
                  const name = COURSE_NAMES[opt.sessions]
                  const on = course === name
                  return (
                    <button
                      key={opt.sessions}
                      type="button"
                      onClick={() => setCourse(name)}
                      className="flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-bold transition-colors active:scale-[0.98]"
                      style={
                        on
                          ? { backgroundColor: '#FFF7ED', borderColor: ORANGE, color: ORANGE }
                          : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                      }
                    >
                      <span className="flex items-baseline gap-2">
                        <span>{name}コース</span>
                        <span className="text-[11px] font-normal text-gray-500">{opt.sessions}回</span>
                      </span>
                      <span className="tabular-nums" style={{ color: on ? ORANGE : '#374151' }}>
                        {opt.amount.toLocaleString()}円
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setCourse(COURSE_CONSULT)}
                  className="px-4 py-3 rounded-xl border-2 text-sm font-bold transition-colors active:scale-[0.98]"
                  style={
                    course === COURSE_CONSULT
                      ? { backgroundColor: '#FFF7ED', borderColor: ORANGE, color: ORANGE }
                      : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#4b5563' }
                  }
                >
                  {COURSE_CONSULT}
                </button>
              </div>
              {course && (
                <button
                  type="button"
                  onClick={() => setCourse('')}
                  className="mt-2 text-[11px] text-gray-500 underline underline-offset-2"
                >
                  コース選択をクリア
                </button>
              )}
            </>
          )}
        </section>

        {/* 3. 希望コマ */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            希望の日・時間帯
            <span className="ml-2 text-xs font-normal" style={{ color: ORANGE }}>必須</span>
          </label>
          <p className="text-xs text-gray-700 mb-1 leading-relaxed">
            来られそうな枠を<span className="font-bold">できるだけたくさん</span>タップしてください。
          </p>
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
            「全○」ボタンでその日のコマをまとめて選べます。土日は塾がお休みのため入力できません。
          </p>

          {/* メイン・予備の案内 */}
          <div className="rounded-xl px-3 py-3 mb-3 border-2 text-sm leading-relaxed" style={{ backgroundColor: '#FFF7ED', borderColor: ORANGE }}>
            <p className="text-gray-800">
              夏期講習は主に <span className="font-bold" style={{ color: ORANGE }}>②・③の時間帯（メイン）</span> で行います。可能な限りたくさんお選びください。
            </p>
            <p className="text-xs text-gray-700 mt-1.5 leading-relaxed">
              お席の都合がつかない場合に <span className="font-bold">①・④・⑤（予備）を組み合わせて</span> ご調整することがあります。
              予備にも来られそうな枠があれば、お席のご用意がしやすくなります。
            </p>
          </div>

          {/* 時間帯の凡例 */}
          <div className="rounded-xl px-3 py-2 mb-3 border border-gray-200 space-y-1 text-xs text-gray-700">
            {SUMMER_SLOTS.map(s => {
              const main = isMainSlot(s.slot)
              return (
                <div key={s.slot} className="flex items-center gap-2 tabular-nums">
                  <span className="font-bold w-5 text-center" style={{ color: main ? ORANGE : '#9ca3af' }}>{s.label}</span>
                  <span className={main ? 'text-gray-800 font-semibold' : 'text-gray-500'}>{s.start}〜{s.end}</span>
                  <span
                    className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                    style={
                      main
                        ? { backgroundColor: ORANGE, color: 'white' }
                        : { backgroundColor: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }
                    }
                  >
                    {main ? 'メイン' : '予備'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* マトリクス */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {/* ヘッダー行 */}
            <div className="flex items-stretch bg-gray-50 px-1.5 pt-2 pb-1.5 text-[11px] font-bold text-gray-600 border-b border-gray-200">
              <div className="w-12 shrink-0 pl-1 flex items-center">日付</div>
              {SUMMER_SLOTS.map(s => {
                const main = isMainSlot(s.slot)
                return (
                  <div
                    key={s.slot}
                    className="flex-1 flex flex-col items-center justify-end gap-0.5 py-0.5"
                    style={{ backgroundColor: main ? '#FFF7ED' : undefined }}
                  >
                    <span
                      style={{
                        color: main ? ORANGE : '#9ca3af',
                        fontSize: main ? '16px' : '11px',
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={
                        main
                          ? { backgroundColor: ORANGE, color: 'white', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, lineHeight: 1 }
                          : { backgroundColor: '#f3f4f6', color: '#9ca3af', padding: '1px 3px', borderRadius: '3px', fontSize: '8px', fontWeight: 700, lineHeight: 1 }
                      }
                    >
                      {main ? 'メイン' : '予備'}
                    </span>
                  </div>
                )
              })}
              <div className="w-10 shrink-0 text-center text-[9px] text-gray-500 flex items-center justify-center">一括</div>
            </div>

            {/* 日付行 */}
            <div>
              {rows.map((row, idx) => {
                if (row.type === 'closed') {
                  return (
                    <div
                      key={`closed-${idx}`}
                      className="flex items-center justify-center gap-2 py-2.5 bg-gray-100 border-y border-gray-200 text-[11px] font-bold text-gray-500"
                    >
                      <span>━ {row.label} {row.rangeLabel} ━</span>
                    </div>
                  )
                }
                const dow = row.dow
                const dayLabel = '日月火水木金土'[dow]
                const dayNum = parseInt(row.date.split('-')[2])
                const month = parseInt(row.date.split('-')[1])
                const dateLabel = `${month}/${dayNum}`
                const rowAllOn = ALL_SLOT_NUMS.every(slot => has(row.date, slot))
                return (
                  <div
                    key={row.date}
                    className="flex items-stretch px-1.5 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="w-12 shrink-0 pl-1 text-xs tabular-nums flex flex-col justify-center text-gray-700">
                      <div className="font-semibold leading-tight">{dateLabel}</div>
                      <div className="text-[10px] leading-tight text-gray-500">({dayLabel})</div>
                    </div>
                    {SUMMER_SLOTS.map(s => {
                      const main = isMainSlot(s.slot)
                      const on = has(row.date, s.slot)
                      return (
                        <div
                          key={s.slot}
                          className="flex-1 flex justify-center items-center py-1.5"
                          style={{ backgroundColor: main ? '#FFFBF5' : undefined }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCell(row.date, s.slot)}
                            className={`${main ? 'w-11 h-11 rounded-lg border-2' : 'w-7 h-7 rounded-md border'} flex items-center justify-center transition-colors active:scale-95`}
                            style={
                              main
                                ? on
                                  ? { backgroundColor: ORANGE, borderColor: ORANGE, color: 'white' }
                                  : { backgroundColor: 'white', borderColor: '#FDBA74', color: '#FB923C' }
                                : on
                                  ? { backgroundColor: '#9ca3af', borderColor: '#9ca3af', color: 'white' }
                                  : { backgroundColor: 'white', borderColor: '#e5e7eb', color: '#d1d5db' }
                            }
                            aria-label={`${dateLabel} ${s.label} ${main ? 'メイン' : '予備'} ${on ? '解除' : '選択'}`}
                          >
                            {on
                              ? <span style={{ fontSize: main ? '20px' : '12px', fontWeight: 700, lineHeight: 1 }}>✓</span>
                              : <span style={{ fontSize: main ? '12px' : '10px', lineHeight: 1 }}>・</span>}
                          </button>
                        </div>
                      )
                    })}
                    <div className="w-10 shrink-0 flex justify-center items-center">
                      <button
                        type="button"
                        onClick={() => setSlotsForDate(row.date, ALL_SLOT_NUMS, !rowAllOn)}
                        className="text-[10px] font-bold px-1.5 py-1 rounded-md border"
                        style={
                          rowAllOn
                            ? { color: '#9ca3af', borderColor: '#e5e7eb', backgroundColor: 'white' }
                            : { color: ORANGE, borderColor: ORANGE, backgroundColor: '#FFF7ED' }
                        }
                      >
                        {rowAllOn ? '解除' : '全○'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-3 text-right">
            選択中：
            <span className="font-bold ml-1" style={{ color: ORANGE }}>メイン {mainCount}</span>
            <span className="mx-1">/</span>
            <span className="font-bold text-gray-600">予備 {reserveCount}</span>
            <span className="ml-2 text-[11px] text-gray-500">（合計 {selected.size} コマ）</span>
          </p>
        </section>

        {/* 4. 要望 */}
        <section className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <label className="block text-sm font-bold text-gray-800 mb-2">
            ご要望・受けたい科目など
            <span className="ml-2 text-xs font-normal text-gray-400">任意</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="例：数学を中心に受けたいです。8月後半は旅行で参加できません。"
            rows={5}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 resize-y"
          />
        </section>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </main>

      {/* 確認画面へ進むボタン（画面下に固定） */}
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
