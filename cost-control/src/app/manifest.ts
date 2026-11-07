import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'S-2000 Project Cost Control',
    short_name: 'S-2000 Cost',
    description: 'ระบบควบคุมต้นทุนและติดตามโครงการ',
    start_url: '/',
    display: 'standalone',
    // หน้าเปิดแอป (splash) ของ Android ใช้สีนี้เป็นพื้น และโลโก้ขาวบนน้ำเงินตรงกลาง ให้ต่อเนื่องกับแถบด้านบนของแอป
    background_color: '#1e3a8a',
    theme_color: '#1e3a8a',
    orientation: 'portrait',
    lang: 'th',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
