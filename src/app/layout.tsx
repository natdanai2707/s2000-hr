import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { SessionProvider } from 'next-auth/react'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'S-2000 Leave System',
  description: 'ระบบลาและบันทึกการปฏิบัติงาน',
  manifest: '/manifest.json',
  themeColor: '#06C755',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'S-2000',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#06C755" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="S-2000" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={geist.className}>
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}