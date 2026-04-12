'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [teacherCode, setTeacherCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('juku_teacher')
    if (saved) {
      const teacher = JSON.parse(saved)
      router.replace(teacher.is_admin ? '/admin' : '/attendance')
    }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: err } = await supabase
      .from('itoshima_teachers')
      .select('id, name, password, is_admin')
      .eq('code', parseInt(teacherCode))
      .single()

    if (err || !data) {
      setError('講師IDが見つかりません')
      setLoading(false)
      return
    }

    if (data.password !== password) {
      setError('パスワードが正しくありません')
      setLoading(false)
      return
    }

    localStorage.setItem(
      'juku_teacher',
      JSON.stringify({ id: data.id, name: data.name, is_admin: data.is_admin })
    )
    router.push(data.is_admin ? '/admin' : '/attendance')
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header
        className="py-5 text-center shadow-md"
        style={{ backgroundColor: '#FF7F00' }}
      >
        <h1 className="text-white text-2xl font-bold tracking-wide">糸島学習塾</h1>
        <p className="text-white/80 text-sm mt-1">講師 勤怠管理システム</p>
      </header>

      <div className="flex-1 flex items-center justify-center relative px-4 py-8 overflow-hidden">
        <div className="hidden md:block absolute left-0 bottom-0 select-none pointer-events-none">
          <Image src="/orange_left.jpg" alt="" width={220} height={280} className="object-contain" />
        </div>
        <div className="hidden md:block absolute right-0 bottom-0 select-none pointer-events-none">
          <Image src="/orange_right.jpg" alt="" width={220} height={280} className="object-contain" />
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-orange-100 p-8 w-full max-w-sm z-10">
          <div className="md:hidden flex justify-center mb-4">
            <Image src="/orange_left.jpg" alt="" width={80} height={100} className="object-contain" />
          </div>

          <h2 className="text-xl font-bold text-center mb-6" style={{ color: '#FF7F00' }}>
            ログイン
          </h2>

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">講師ID</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={teacherCode}
                onChange={(e) => setTeacherCode(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-3.5 text-center text-2xl tracking-wide focus:outline-none focus:border-[#FF7F00]"
                placeholder="0000"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-3.5 text-base focus:outline-none focus:border-[#FF7F00]"
                placeholder="パスワードを入力"
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-60 mt-1"
              style={{ backgroundColor: '#FF7F00' }}
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
