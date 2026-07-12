'use client'

import { use } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useState } from 'react'

export default function DemoPage() {
  const router = useRouter()
  const params = useParams()
  const role = params.role as string
  const isApprover = role === 'approver'

  const today = new Date()
  const [viewMonth] = useState(today.getMonth())
  const [viewYear] = useState(today.getFullYear())
  const todayDate = today.getDate()

  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
  const thaiDays = ['อา','จ','อ','พ','พฤ','ศ','ส']

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  // Mock data: จุดสีในปฏิทิน
  const mockDots: Record<number, string[]> = {
    [todayDate - 4]: ['bg-green-500'],
    [todayDate - 3]: ['bg-green-500'],
    [todayDate - 2]: ['bg-red-500'],
    [todayDate - 1]: ['bg-green-500'],
    [todayDate]: ['bg-green-500'],
    [todayDate + 3]: ['bg-yellow-400'],
  }

  function demoAlert() {
    alert('🔒 โหมดทดลอง\n\nการบันทึกข้อมูลถูกปิดในโหมดนี้\nกรุณาเข้าสู่ระบบด้วย LINE เพื่อใช้งานจริง')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Demo banner */}
      <div className="bg-amber-400 text-amber-900 text-center text-xs py-1.5 font-medium">
        🔍 โหมดทดลอง ({isApprover ? 'ผู้อนุมัติ' : 'พนักงาน'}) · ข้อมูลตัวอย่าง ไม่สามารถบันทึกได้
      </div>

      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-800">S-2000</h1>
          <p className="text-xs text-gray-500">
            {isApprover ? 'หัวหน้าทดลอง (Demo) · หัวหน้างาน' : 'พนักงานทดลอง (Demo) · ช่างเชื่อม'}
          </p>
        </div>
        <button onClick={() => router.push('/login')} className="text-xs text-gray-400">ออกจากโหมดทดลอง</button>
      </div>

      <div className="max-w-lg mx-auto px-3 py-3 space-y-4">

        {/* ปฏิทิน */}
        <div className="bg-white rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2 px-1">
            <button className="p-1.5 rounded-lg text-gray-500 text-lg leading-none">‹</button>
            <span className="font-semibold text-gray-800 text-sm">{thaiMonths[viewMonth]} {viewYear + 543}</span>
            <button className="p-1.5 rounded-lg text-gray-500 text-lg leading-none">›</button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {thaiDays.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-400'}`}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const isToday = day === todayDate
              const isSunday = idx % 7 === 0
              const isSaturday = idx % 7 === 6
              const dots = mockDots[day] || []

              return (
                <button
                  key={idx}
                  onClick={demoAlert}
                  className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition
                    ${isToday ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}
                    ${isSunday && !isToday ? 'text-red-500' : isSaturday && !isToday ? 'text-blue-500' : !isToday ? 'text-gray-700' : ''}
                  `}
                >
                  <span className="text-sm font-medium leading-none">{day}</span>
                  {dots.length > 0 && (
                    <div className="flex gap-0.5 mt-1">
                      {dots.map((color, i) => (
                        <div key={i} className={`w-1.5 h-1.5 rounded-full ${color} ${isToday ? 'opacity-80' : ''}`} />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
            {[
              { color: 'bg-green-500', label: 'บันทึกงานแล้ว' },
              { color: 'bg-red-500', label: 'ลา (อนุมัติ)' },
              { color: 'bg-yellow-400', label: 'ลา (รออนุมัติ)' },
              { color: 'bg-purple-400', label: 'วันหยุด' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full shrink-0 ${item.color}`} />
                <span className="text-xs text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Approver: รออนุมัติ */}
        {isApprover && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">รออนุมัติจากคุณ (2)</h2>
            <div className="space-y-2">
              <div onClick={demoAlert} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">พนักงานทดลอง (Demo)</p>
                    <p className="text-xs text-gray-500">ลาป่วย · 1 วัน · {`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(todayDate+3).padStart(2,'0')}`}</p>
                  </div>
                  <span className="text-yellow-600 text-xs">อนุมัติ →</span>
                </div>
              </div>
              <div onClick={demoAlert} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">พนักงานทดลอง (Demo)</p>
                    <p className="text-xs text-gray-500">OT · 2 ชม. (1.5x = 3 ชม.)</p>
                  </div>
                  <span className="text-yellow-600 text-xs">อนุมัติ →</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: '📋', label: 'ยื่นคำขอลา', sub: 'ลา/มาสาย/ขาด', bg: 'bg-[#06C755]' },
            { icon: '🔧', label: 'บันทึกงาน', sub: 'รายงานการปฏิบัติงาน', bg: 'bg-blue-600' },
            { icon: '📍', label: 'เช็คอิน/เอาท์', sub: 'พนักงานประจำไซต์', bg: 'bg-orange-500' },
            { icon: '⏰', label: 'ขอทำ OT', sub: 'ยื่นขออนุมัติ OT', bg: 'bg-yellow-500' },
            { icon: '📜', label: 'ประวัติคำขอ', sub: 'ลา / OT / บันทึกงาน', bg: 'bg-gray-600' },
          ].map(btn => (
            <button key={btn.label} onClick={demoAlert} className={`${btn.bg} text-white rounded-xl p-3 text-left`}>
              <div className="text-xl mb-1">{btn.icon}</div>
              <div className="font-medium text-xs">{btn.label}</div>
              <div className="text-xs opacity-70 mt-0.5">{btn.sub}</div>
            </button>
          ))}
        </div>

        {/* คำขอลาตัวอย่าง */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">คำขอลาของฉัน</h2>
          <div className="space-y-2">
            <div onClick={demoAlert} className="bg-white rounded-xl p-3 cursor-pointer border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800 text-sm">ลาป่วย</p>
                  <p className="text-xs text-gray-500">{`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(Math.max(todayDate-2,1)).padStart(2,'0')}`} · 1 วัน</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">อนุมัติแล้ว</span>
              </div>
            </div>
            <div onClick={demoAlert} className="bg-white rounded-xl p-3 cursor-pointer border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800 text-sm">ลากิจ</p>
                  <p className="text-xs text-gray-500">{`${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(Math.min(todayDate+3,28)).padStart(2,'0')}`} · 1 วัน</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">รออนุมัติ</span>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => router.push('/login')}
          className="w-full bg-[#06C755] text-white rounded-xl py-3 font-medium text-sm"
        >
          เข้าสู่ระบบด้วย LINE เพื่อใช้งานจริง
        </button>
      </div>
    </div>
  )
}
