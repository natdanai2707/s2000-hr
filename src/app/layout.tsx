import type { Metadata, Viewport } from 'next'
import { Noto_Sans_Thai } from 'next/font/google'
import './globals.css'
import { SessionProvider } from 'next-auth/react'

const notoThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-thai',
})

export const metadata: Metadata = {
  title: 'S-2000 HR',
  description: 'ระบบบันทึกข้อมูลการทำงาน',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'S-2000',
  },
}

export const viewport: Viewport = {
  themeColor: '#059669',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th" className={notoThai.variable}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="font-sans antialiased">
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}
