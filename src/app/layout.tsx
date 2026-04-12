import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "糸島学習塾 勤怠管理",
  description: "糸島学習塾の講師勤怠管理システム",
  manifest: "/manifest.json",
  icons: {
    icon: "/orange_right.jpg",
    apple: "/orange_right.jpg",
  },
};

export const viewport: Viewport = {
  themeColor: "#FF7F00",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
