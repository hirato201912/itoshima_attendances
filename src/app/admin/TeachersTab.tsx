'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

const ORANGE = '#FF7F00'
const SOROBAN_COLOR = '#B8860B'

// 講師IDの採番の目安：塾は3000番台、そろばんは4000番台
const CODE_BASE = { juku: 3000, soroban: 4000 } as const

type TeacherRow = {
  id: string
  name: string
  code: number
  password: string
  is_juku_teacher: boolean
  is_soroban: boolean
}

type Filter = 'all' | 'juku' | 'soroban'

type FormState = {
  id: string | null   // null = 新規登録
  name: string
  code: string
  password: string
  isJuku: boolean
  isSoroban: boolean
}

const emptyForm: FormState = { id: null, name: '', code: '', password: '', isJuku: true, isSoroban: false }

// 管理者アカウントは一覧・編集の対象外
async function loadTeachers(): Promise<TeacherRow[]> {
  const { data } = await supabase
    .from('itoshima_teachers')
    .select('id, name, code, password, is_juku_teacher, is_soroban')
    .eq('is_admin', false)
    .eq('is_soroban_admin', false)
    .order('code')
  return (data ?? []) as TeacherRow[]
}

export default function TeachersTab() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 初回は loading=true で始まり、保存後の再取得では一覧を出したまま差し替える
  const fetchTeachers = () => loadTeachers().then(rows => {
    setTeachers(rows)
    setLoading(false)
  })

  useEffect(() => {
    loadTeachers().then(rows => {
      setTeachers(rows)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => teachers.filter(t =>
    filter === 'all' ? true : filter === 'juku' ? t.is_juku_teacher : t.is_soroban
  ), [teachers, filter])

  const counts = useMemo(() => ({
    all: teachers.length,
    juku: teachers.filter(t => t.is_juku_teacher).length,
    soroban: teachers.filter(t => t.is_soroban).length,
  }), [teachers])

  // 区分に応じて次の講師IDを提案（そろばんのみ→4000番台、それ以外→3000番台）
  const suggestCode = (isJuku: boolean, isSoroban: boolean): string => {
    const base = isSoroban && !isJuku ? CODE_BASE.soroban : CODE_BASE.juku
    const inRange = teachers.map(t => t.code).filter(c => c >= base && c < base + 1000)
    return String(inRange.length ? Math.max(...inRange) + 1 : base + 1)
  }

  const openNew = () => {
    const code = suggestCode(true, false)
    setForm({ ...emptyForm, code, password: code })
    setError('')
  }

  const openEdit = (t: TeacherRow) => {
    setForm({
      id: t.id, name: t.name, code: String(t.code), password: t.password,
      isJuku: t.is_juku_teacher, isSoroban: t.is_soroban,
    })
    setError('')
  }

  // 新規登録中に区分を切り替えたら、講師ID（と同じ値の初期パスワード）も提案し直す
  const changeKind = (isJuku: boolean, isSoroban: boolean) => {
    if (!form) return
    if (form.id) { setForm({ ...form, isJuku, isSoroban }); return }
    const code = suggestCode(isJuku, isSoroban)
    const passwordFollowsCode = form.password === form.code
    setForm({ ...form, isJuku, isSoroban, code, password: passwordFollowsCode ? code : form.password })
  }

  const save = async () => {
    if (!form) return
    const name = form.name.trim()
    const code = parseInt(form.code)
    const password = form.password.trim()

    if (!name) { setError('名前を入力してください'); return }
    if (!/^\d+$/.test(form.code) || !code) { setError('講師IDは数字で入力してください'); return }
    if (!password) { setError('パスワードを入力してください'); return }
    if (!form.isJuku && !form.isSoroban) { setError('塾・そろばんのどちらかを選んでください'); return }

    setSaving(true)
    setError('')

    // 講師IDはログインに使うため重複不可（管理者アカウントも含めて確認）
    const { data: dup } = await supabase
      .from('itoshima_teachers')
      .select('id, name')
      .eq('code', code)
    if (dup && dup.some(d => d.id !== form.id)) {
      setError(`講師ID ${code} は ${dup[0].name} さんが使用しています`)
      setSaving(false)
      return
    }

    const payload = { name, code, password, is_juku_teacher: form.isJuku, is_soroban: form.isSoroban }
    const { error: err } = form.id
      ? await supabase.from('itoshima_teachers').update(payload).eq('id', form.id)
      : await supabase.from('itoshima_teachers').insert({ ...payload, is_admin: false, is_soroban_admin: false })

    setSaving(false)
    if (err) { setError('保存できませんでした。通信状況を確認してください'); return }
    setForm(null)
    fetchTeachers()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 bg-white rounded-2xl shadow px-6 py-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['all', 'juku', 'soroban'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-4 py-2 rounded-lg text-sm font-bold transition-colors"
              style={filter === f
                ? { backgroundColor: '#fff', color: '#1f2937', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                : { color: '#6b7280' }}
            >
              {f === 'all' ? '全員' : f === 'juku' ? '塾' : 'そろばん'}（{counts[f]}）
            </button>
          ))}
        </div>
        <button
          onClick={openNew}
          className="ml-auto px-5 py-2.5 rounded-xl text-white text-sm font-bold"
          style={{ backgroundColor: ORANGE }}
        >
          講師を追加
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-gray-400 text-sm">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">該当する講師はいません</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-2.5 text-left font-bold w-24">講師ID</th>
                <th className="px-4 py-2.5 text-left font-bold">名前</th>
                <th className="px-4 py-2.5 text-left font-bold">区分</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-mono text-gray-600">{t.code}</td>
                  <td className="px-4 py-3 font-bold text-gray-800">{t.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {t.is_juku_teacher && <KindBadge kind="juku" />}
                      {t.is_soroban && <KindBadge kind="soroban" />}
                      {!t.is_juku_teacher && !t.is_soroban && <span className="text-xs text-gray-400">区分なし</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(t)} className="text-sm font-bold underline underline-offset-2" style={{ color: ORANGE }}>
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-5">{form.id ? '講師情報の編集' : '講師の追加'}</h3>

            <div className="flex flex-col gap-4">
              <div>
                <p className="block text-sm font-bold text-gray-700 mb-1.5">区分（両方選べます）</p>
                <div className="flex gap-2">
                  <KindToggle label="塾" color={ORANGE} checked={form.isJuku} onChange={v => changeKind(v, form.isSoroban)} />
                  <KindToggle label="そろばん" color={SOROBAN_COLOR} checked={form.isSoroban} onChange={v => changeKind(form.isJuku, v)} />
                </div>
              </div>

              <label className="block">
                <span className="block text-sm font-bold text-gray-700 mb-1.5">名前</span>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="例：糸島太郎"
                  autoFocus
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-[#FF7F00]"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-bold text-gray-700 mb-1.5">講師ID（ログイン用の数字）</span>
                <input
                  value={form.code}
                  inputMode="numeric"
                  onChange={e => {
                    const code = e.target.value.replace(/\D/g, '')
                    const passwordFollowsCode = !form.id && form.password === form.code
                    setForm({ ...form, code, password: passwordFollowsCode ? code : form.password })
                  }}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-[#FF7F00]"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-bold text-gray-700 mb-1.5">パスワード</span>
                <input
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:border-[#FF7F00]"
                />
                {!form.id && <span className="block text-xs text-gray-400 mt-1">初期値は講師IDと同じです</span>}
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setForm(null)}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg border-2 border-gray-200 text-gray-700 text-sm font-bold disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg text-white text-sm font-bold disabled:opacity-50"
                  style={{ backgroundColor: ORANGE }}
                >
                  {saving ? '保存中…' : form.id ? '保存' : '登録'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function KindBadge({ kind }: { kind: 'juku' | 'soroban' }) {
  const style = kind === 'juku'
    ? { backgroundColor: '#FFF0E0', color: '#CC5500' }
    : { backgroundColor: '#FEF6D8', color: '#8A6500' }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={style}>
      {kind === 'juku' ? '塾' : 'そろばん'}
    </span>
  )
}

function KindToggle({ label, color, checked, onChange }: {
  label: string; color: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex-1 py-2.5 rounded-lg border-2 text-sm font-bold transition-colors"
      style={checked
        ? { borderColor: color, backgroundColor: color, color: '#fff' }
        : { borderColor: color, backgroundColor: '#fff', color }}
    >
      {checked ? '✓ ' : ''}{label}
    </button>
  )
}
