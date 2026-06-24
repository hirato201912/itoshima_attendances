import type { Metadata } from 'next'

const TITLE = '夏期講習 お申込み｜糸島学習塾YES'
const DESCRIPTION = '夏期講習のお申込みフォームです。ご希望のコース・日程をスマートフォンから簡単にご登録いただけます。'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    locale: 'ja_JP',
    siteName: '糸島学習塾YES',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function SummerApplyLayout({ children }: { children: React.ReactNode }) {
  return children
}
