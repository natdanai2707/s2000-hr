'use client'

import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const [showDemo, setShowDemo] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-2xl shadow-sm mx-auto mb-4 flex items-center justify-center">
            <span className="text-xl font-bold text-gray-800">S2000</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">S-2000 HR</h1>
          <p className="text-gray-500 mt-1 text-sm">ระบบบันทึกข้อมูลการทำงาน</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
          <button
            onClick={() => signIn('line', { callbackUrl: '/dashboard' })}
            className="w-full flex items-center justify-center gap-3 bg-[#06C755] text-white rounded-xl py-3.5 font-medium text-sm hover:bg-[#05b54d] transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
            </svg>
            เข้าสู่ระบบด้วย LINE
          </button>

          <button
            onClick={() => setShowDemo(!showDemo)}
            className="w-full text-center text-xs text-gray-400 py-1"
          >
            {showDemo ? 'ซ่อนโหมดทดลอง' : 'ทดลองใช้งาน (Demo)'}
          </button>

          {showDemo && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => router.push('/demo/employee')}
                className="w-full flex items-center justify-center gap-2 bg-blue-50 text-blue-600 rounded-xl py-3 font-medium text-sm hover:bg-blue-100 transition"
              >
                👷 ทดลองแบบพนักงาน
              </button>
              <button
                onClick={() => router.push('/demo/approver')}
                className="w-full flex items-center justify-center gap-2 bg-amber-50 text-amber-600 rounded-xl py-3 font-medium text-sm hover:bg-amber-100 transition"
              >
                👔 ทดลองแบบผู้อนุมัติ
              </button>
              <p className="text-xs text-gray-400 text-center pt-1">
                โหมดทดลองใช้ข้อมูลตัวอย่าง ไม่กระทบข้อมูลจริง
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          เฉพาะพนักงาน S-2000 เท่านั้น
        </p>
      </div>
    </div>
  )
}