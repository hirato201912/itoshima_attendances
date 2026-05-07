'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type Device = 'ios' | 'android' | 'desktop' | 'unknown'

function detectDevice(): Device {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Windows|Linux/.test(ua)) return 'desktop'
  return 'unknown'
}

export default function InstallPage() {
  const [device, setDevice] = useState<Device>('unknown')
  const [tab, setTab] = useState<'ios' | 'android'>('ios')
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const d = detectDevice()
    setDevice(d)
    if (d === 'android') setTab('android')
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header
        className="py-5 text-center shadow-md"
        style={{ backgroundColor: '#FF7F00' }}
      >
        <h1 className="text-white text-xl font-bold">ホーム画面に追加する方法</h1>
        <p className="text-white/80 text-xs mt-1">アプリのように使えるようになります</p>
      </header>

      <main className="flex-1 px-4 py-6 max-w-xl mx-auto w-full">
        {isStandalone && (
          <div className="mb-6 rounded-xl border border-green-300 bg-green-50 p-4 text-green-800">
            <p className="font-bold">すでに追加済みです</p>
            <p className="text-sm mt-1">この画面はホーム画面のアイコンから開かれています。</p>
          </div>
        )}

        <div className="flex justify-center mb-6">
          <Image
            src="/icon-512.png"
            alt="アプリアイコン"
            width={96}
            height={96}
            className="rounded-2xl shadow"
          />
        </div>

        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-gray-800">
          お使いの端末は <strong>{device === 'ios' ? 'iPhone / iPad' : device === 'android' ? 'Android' : 'パソコンまたは不明'}</strong> と判定されました。
        </div>

        <div className="flex border-b border-gray-200 mb-4">
          <button
            onClick={() => setTab('ios')}
            className={`flex-1 py-2 text-sm font-bold ${
              tab === 'ios'
                ? 'border-b-2 text-[#FF7F00]'
                : 'text-gray-500'
            }`}
            style={tab === 'ios' ? { borderColor: '#FF7F00' } : undefined}
          >
            iPhone / iPad
          </button>
          <button
            onClick={() => setTab('android')}
            className={`flex-1 py-2 text-sm font-bold ${
              tab === 'android'
                ? 'border-b-2 text-[#FF7F00]'
                : 'text-gray-500'
            }`}
            style={tab === 'android' ? { borderColor: '#FF7F00' } : undefined}
          >
            Android
          </button>
        </div>

        {tab === 'ios' ? (
          <ol className="space-y-4">
            <Step n={1}>
              <p>
                <strong>Safari</strong>でこのページを開きます。
              </p>
              <p className="text-xs text-gray-500 mt-1">
                ※ ChromeやLINEから開いている場合は、画面下や右上のメニューから「Safariで開く」を選んでください。Safari以外ではホーム画面に追加できません。
              </p>
            </Step>
            <Step n={2}>
              <p>
                画面下中央の<strong>共有ボタン</strong>（<ShareIcon /> このマーク）をタップします。
              </p>
            </Step>
            <Step n={3}>
              <p>
                メニューを下にスクロールして<strong>「ホーム画面に追加」</strong>をタップします。
              </p>
            </Step>
            <Step n={4}>
              <p>
                右上の<strong>「追加」</strong>をタップして完了です。
              </p>
              <p className="text-xs text-gray-500 mt-1">
                ホーム画面にクマのアイコンが追加されます。次からはアイコンをタップして起動してください。
              </p>
            </Step>
          </ol>
        ) : (
          <ol className="space-y-4">
            <Step n={1}>
              <p>
                <strong>Chrome</strong>でこのページを開きます。
              </p>
              <p className="text-xs text-gray-500 mt-1">
                ※ LINEなどのアプリ内ブラウザから開いている場合は、右上のメニューから「Chromeで開く」を選んでください。
              </p>
            </Step>
            <Step n={2}>
              <p>
                画面右上の<strong>メニュー（︙）</strong>をタップします。
              </p>
            </Step>
            <Step n={3}>
              <p>
                <strong>「ホーム画面に追加」</strong>または<strong>「アプリをインストール」</strong>をタップします。
              </p>
              <p className="text-xs text-gray-500 mt-1">
                端末によっては画面下に「インストール」のバナーが自動で出る場合もあります。その場合はバナーをタップしてください。
              </p>
            </Step>
            <Step n={4}>
              <p>
                <strong>「追加」</strong>または<strong>「インストール」</strong>をタップして完了です。
              </p>
              <p className="text-xs text-gray-500 mt-1">
                ホーム画面（またはアプリ一覧）にクマのアイコンが追加されます。
              </p>
            </Step>
          </ol>
        )}

        <div className="mt-8 rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700">
          <p className="font-bold mb-1">うまくいかない場合</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>iPhoneは <strong>必ずSafari</strong>、Androidは <strong>Chrome</strong> で開いてください。</li>
            <li>すでに追加済みの場合、メニューに「ホーム画面に追加」が出ないことがあります。</li>
            <li>うまくいかない時は、塾長までご連絡ください。</li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-xl text-white font-bold"
            style={{ backgroundColor: '#FF7F00' }}
          >
            ログイン画面に戻る
          </Link>
        </div>
      </main>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full text-white font-bold flex items-center justify-center"
        style={{ backgroundColor: '#FF7F00' }}
      >
        {n}
      </span>
      <div className="flex-1 pt-1 text-gray-800">{children}</div>
    </li>
  )
}

function ShareIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block w-4 h-4 align-text-bottom mx-0.5"
      style={{ color: '#FF7F00' }}
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}
