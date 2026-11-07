import type { Metadata, Viewport } from 'next'
import { Bai_Jamjuree, Noto_Sans_Thai } from 'next/font/google'
import './globals.css'

const notoThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-thai',
})

// หัวข้อและตัวเลขสำคัญ
const baiJamjuree = Bai_Jamjuree({
  subsets: ['thai', 'latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-display-th',
})

export const metadata: Metadata = {
  title: 'S-2000 Project Cost Control',
  description: 'ระบบควบคุมต้นทุนและติดตามโครงการ บริษัท เอส-2000 สตีล แฟบริเคท จำกัด',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'S-2000 Cost' },
}

export const viewport: Viewport = {
  themeColor: '#1e3a8a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${notoThai.variable} ${baiJamjuree.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
