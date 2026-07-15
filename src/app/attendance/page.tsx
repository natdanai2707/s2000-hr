'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { todayISO, formatThaiTime } from '@/lib/date'

interface SiteLocation {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  project?: { project_code: string; project_name: string }
}

interface AttendanceLog {
  id: string
  check_in: string
  check_out: string | null
  site_location: SiteLocation
  note: string | null
}

function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatTime(iso: string) {
  return formatThaiTime(iso)
}

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} กม.` : `${Math.round(m)} ม.`
}

function calcDuration(checkIn: string, checkOut: string | null) {
  if (!checkOut) return null
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  return `${hours} ชม. ${minutes} นาที`
}

export default function AttendancePage() {
  const { data: session } = useSession()
  const router = useRouter()

  const [sites, setSites] = useState<SiteLocation[]>([])
  const [todayLogs, setTodayLogs] = useState<AttendanceLog[]>([])
  const [activeLog, setActiveLog] = useState<AttendanceLog | null>(null)
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [locationError, setLocationError] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [note, setNote] = useState('')

  const today = todayISO()

  useEffect(() => {
    if (session?.user?.employeeId) {
      fetchData()
      getLocation()
    }
  }, [session])

  async function fetchData() {
    setLoading(true)
    const startOfDay = `${today}T00:00:00+07:00`
    const endOfDay = `${today}T23:59:59+07:00`

    const [sitesRes, logsRes] = await Promise.all([
      supabase
        .from('site_locations')
        .select('*, project:projects(project_code, project_name)')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('attendance_logs')
        .select('*, site_location:site_locations(*, project:projects(project_code, project_name))')
        .eq('employee_id', session!.user.employeeId!)
        .gte('check_in', startOfDay)
        .lte('check_in', endOfDay)
        .order('check_in', { ascending: false }),
    ])

    setSites(sitesRes.data || [])

    const logs = (logsRes.data || []) as AttendanceLog[]
    setTodayLogs(logs)

    // หา log ที่ยังไม่ได้เช็คเอาท์
    const active = logs.find(l => !l.check_out) || null
    setActiveLog(active)

    setLoading(false)
  }

  function getLocation() {
    if (!navigator.geolocation) {
      setLocationError('เบราว์เซอร์ไม่รองรับ GPS')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocationError('')
      },
      () => setLocationError('ไม่สามารถดึง GPS ได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  useEffect(() => {
    if (!myPosition || sites.length === 0) return
    let nearest: { site: SiteLocation; distance: number } | null = null
    for (const site of sites) {
      const dist = calcDistance(myPosition.lat, myPosition.lng, site.latitude, site.longitude)
      if (!nearest || dist < nearest.distance) nearest = { site, distance: dist }
    }
    if (nearest && nearest.distance <= nearest.site.radius_meters) {
      setSelectedSite(nearest.site.id)
    }
  }, [myPosition, sites])

  const selectedSiteObj = sites.find(s => s.id === selectedSite)
  const distanceToSelected = selectedSiteObj && myPosition
    ? calcDistance(myPosition.lat, myPosition.lng, selectedSiteObj.latitude, selectedSiteObj.longitude)
    : null
  const isInRange = distanceToSelected !== null && selectedSiteObj
    ? distanceToSelected <= selectedSiteObj.radius_meters
    : false

  async function handleCheckIn() {
    if (!session?.user?.employeeId || !selectedSite || !myPosition || !isInRange) return
    setProcessing(true)
    await supabase.from('attendance_logs').insert({
      employee_id: session.user.employeeId,
      site_location_id: selectedSite,
      check_in: new Date().toISOString(),
      check_in_lat: myPosition.lat,
      check_in_lng: myPosition.lng,
      note: note || null,
    })
    await fetchData()
    setNote('')
    setProcessing(false)
  }

  async function handleCheckOut() {
    if (!activeLog || !myPosition) return
    setProcessing(true)
    await supabase
      .from('attendance_logs')
      .update({
        check_out: new Date().toISOString(),
        check_out_lat: myPosition.lat,
        check_out_lng: myPosition.lng,
      })
      .eq('id', activeLog.id)
    await fetchData()
    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">กำลังโหลด...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400">←</button>
        <div>
          <h1 className="font-semibold text-gray-800">เช็คอิน/เช็คเอาท์</h1>
          <p className="text-xs text-gray-400">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* GPS Status */}
        <div className={`rounded-xl p-3 flex items-center gap-2 text-sm ${myPosition ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          <span>{myPosition ? '📍' : '⚠️'}</span>
          <span className="flex-1">
            {myPosition
              ? `GPS พร้อม · ${myPosition.lat.toFixed(5)}, ${myPosition.lng.toFixed(5)}`
              : locationError || 'กำลังดึง GPS...'}
          </span>
          {!myPosition && (
            <button onClick={getLocation} className="underline text-xs shrink-0">ลองใหม่</button>
          )}
        </div>

        {/* Active log - รออยู่ระหว่างเช็คอิน */}
        {activeLog && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800 mb-2">กำลังทำงานอยู่</p>
            <p className="text-sm text-gray-700">📍 {(activeLog.site_location as any)?.name}</p>
            <p className="text-sm text-green-600 font-semibold mt-1">เช็คอิน {formatTime(activeLog.check_in)}</p>
            {activeLog.note && <p className="text-xs text-gray-400 mt-1">{activeLog.note}</p>}
            <button
              onClick={handleCheckOut}
              disabled={processing || !myPosition}
              className="w-full mt-3 bg-orange-500 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
            >
              {processing ? 'กำลังบันทึก...' : '🔴 เช็คเอาท์'}
            </button>
          </div>
        )}

        {/* ฟอร์มเช็คอินใหม่ (แสดงเสมอถ้าไม่มี active log) */}
        {!activeLog && (
          <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-3">
            <p className="font-medium text-gray-800 text-sm">เช็คอินไซต์งาน</p>

            <div className="space-y-2">
              {sites.map(site => {
                const dist = myPosition
                  ? calcDistance(myPosition.lat, myPosition.lng, site.latitude, site.longitude)
                  : null
                const inRange = dist !== null && dist <= site.radius_meters
                return (
                  <button
                    key={site.id}
                    onClick={() => setSelectedSite(site.id)}
                    className={`w-full text-left p-3 rounded-xl border transition ${
                      selectedSite === site.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{site.name}</p>
                        <p className="text-xs text-gray-400">รัศมี {site.radius_meters} ม.</p>
                      </div>
                      {dist !== null && (
                        <div className="text-right shrink-0 ml-2">
                          <p className={`text-sm font-semibold ${inRange ? 'text-green-600' : 'text-red-500'}`}>
                            {formatDistance(dist)}
                          </p>
                          <p className={`text-xs ${inRange ? 'text-green-500' : 'text-red-400'}`}>
                            {inRange ? '✅ อยู่ในรัศมี' : '❌ นอกรัศมี'}
                          </p>
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800"
              placeholder="หมายเหตุ (ถ้ามี)"
            />

            <button
              onClick={handleCheckIn}
              disabled={processing || !selectedSite || !myPosition || !isInRange}
              className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
            >
              {processing ? 'กำลังบันทึก...'
                : !myPosition ? 'รอ GPS...'
                : !selectedSite ? 'เลือกไซต์งานก่อน'
                : !isInRange ? '❌ อยู่นอกรัศมี เช็คอินไม่ได้'
                : '🟢 เช็คอิน'}
            </button>
          </div>
        )}

        {/* ประวัติวันนี้ */}
        {todayLogs.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">
              บันทึกวันนี้ ({todayLogs.length} ครั้ง)
            </p>
            <div className="space-y-2">
              {todayLogs.map((log, idx) => (
                <div key={log.id} className={`bg-white rounded-xl p-3 border ${!log.check_out ? 'border-blue-200' : 'border-gray-100'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        ครั้งที่ {todayLogs.length - idx} · {(log.site_location as any)?.name}
                      </p>
                      <div className="flex gap-4 mt-1 text-xs">
                        <span className="text-green-600">เข้า {formatTime(log.check_in)}</span>
                        {log.check_out
                          ? <span className="text-gray-500">ออก {formatTime(log.check_out)}</span>
                          : <span className="text-orange-500">ยังอยู่ในไซต์</span>}
                        {log.check_out && (
                          <span className="text-gray-400">{calcDuration(log.check_in, log.check_out)}</span>
                        )}
                      </div>
                      {log.note && <p className="text-xs text-gray-400 mt-0.5">{log.note}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sites.length === 0 && (
          <div className="bg-yellow-50 rounded-xl p-4 text-center">
            <p className="text-yellow-700 text-sm">ยังไม่มีไซต์งาน กรุณาติดต่อ Admin</p>
          </div>
        )}
      </div>
    </div>
  )
}