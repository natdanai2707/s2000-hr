import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['exceljs'],
  // ไฟล์ BOQ และรูปใบสั่งซื้ออาจเกิน 1MB ที่เป็นค่าเริ่มต้น แต่ Vercel รับ request ได้ไม่เกิน 4.5MB
  // รูปถูกย่อในเบราว์เซอร์ก่อนส่งอยู่แล้ว ค่านี้เผื่อไว้สำหรับไฟล์ Excel และ PDF
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
