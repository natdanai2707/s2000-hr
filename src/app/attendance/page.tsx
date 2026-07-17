'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { todayISO, formatThaiTime } from '@/lib/date'
import { BottomNav } from '@/components/ui'

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
  site_location: SiteLocation | null
  note: string | null
  selfie_url?: string | null
  is_manual?: boolean
  is_outside_geofence?: boolean
  manual_location?: string | null
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
  const [actionError, setActionError] = useState('')
  const [selfie, setSelfie] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string>('')
  // บันทึกย้อนหลัง (กรอกเอง)
  const [manualMode, setManualMode] = useState(false)
  const [manualForm, setManualForm] = useState({ date: '', inTime: '', outTime: '', location: '', note: '' })
  const [manualError, setManualError] = useState('')
  const [manualDone, setManualDone] = useState('')

  const today = todayISO()

  useEffect(() => {
    if (session?.user?.employeeId) {
      fetchData()
      getLocation()
    }
  }, [session])

  async function fetchData() {
    setLoading(true)
    setActionError('')
    const startOfDay = `${today}T00:00:00+07:00`
    const endOfDay = `${today}T23:59:59+07:00`

    try {
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

      if (sitesRes.error) throw sitesRes.error
      if (logsRes.error) throw logsRes.error

      setSites(sitesRes.data || [])

      const logs = (logsRes.data || []) as AttendanceLog[]
      setTodayLogs(logs)

      // หา log ที่ยังไม่ได้เช็คเอาท์
      const active = logs.find(l => !l.check_out) || null
      setActiveLog(active)
    } catch (e) {
      console.error('attendance fetchData error:', e)
      setActionError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
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

  function onSelfieChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelfie(file)
    if (selfiePreview) URL.revokeObjectURL(selfiePreview)
    setSelfiePreview(URL.createObjectURL(file))
  }

  // อัปโหลดรูป selfie ขึ้น Supabase Storage คืน public url (คืน null ถ้าพลาด)
  async function uploadSelfie(file: File, employeeId: string): Promise<string | null> {
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${employeeId}/${today}-${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('attendance-selfies')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('attendance-selfies').getPublicUrl(path)
      return data.publicUrl
    } catch (e) {
      console.error('selfie upload error:', e)
      return null
    }
  }

  async function handleCheckIn() {
    if (!session?.user?.employeeId || !selectedSite || !myPosition || !isInRange) return
    setProcessing(true)
    setActionError('')
    try {
      // อัปโหลด selfie ก่อน (ถ้ามี) — ถ้าพลาดยังเช็คอินต่อได้
      let selfieUrl: string | null = null
      if (selfie) {
        selfieUrl = await uploadSelfie(selfie, session.user.employeeId)
        if (!selfieUrl) {
          setActionError('อัปโหลดรูปไม่สำเร็จ แต่ระบบจะบันทึกเช็คอินให้ (รูปไม่ถูกบันทึก)')
        }
      }

      const { error } = await supabase.from('attendance_logs').insert({
        employee_id: session.user.employeeId,
        site_location_id: selectedSite,
        check_in: new Date().toISOString(),
        check_in_lat: myPosition.lat,
        check_in_lng: myPosition.lng,
        note: note || null,
        selfie_url: selfieUrl,
      })
      if (error) throw error
      setNote('')
      setSelfie(null)
      if (selfiePreview) URL.revokeObjectURL(selfiePreview)
      setSelfiePreview('')
      await fetchData()
    } catch (e) {
      console.error('check-in error:', e)
      setActionError('เช็คอินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCheckOut() {
    if (!activeLog || !myPosition) return
    setProcessing(true)
    setActionError('')
    try {
      const { error } = await supabase
        .from('attendance_logs')
        .update({
          check_out: new Date().toISOString(),
          check_out_lat: myPosition.lat,
          check_out_lng: myPosition.lng,
        })
        .eq('id', activeLog.id)
      if (error) throw error
      await fetchData()
    } catch (e) {
      console.error('check-out error:', e)
      setActionError('เช็คเอาท์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setProcessing(false)
    }
  }

  // บันทึกเวลาย้อนหลัง กรอกสถานที่เอง — flag ว่าเป็นการทำนอกพื้นที่ + แจ้งแอดมิน
  async function handleManualEntry() {
    if (!session?.user?.employeeId) return
    setManualError('')
    setManualDone('')
    if (!manualForm.date || !manualForm.inTime) {
      setManualError('กรุณากรอกวันที่และเวลาเข้างาน')
      return
    }
    if (!manualForm.location.trim()) {
      setManualError('กรุณากรอกสถานที่ทำงาน')
      return
    }
    if (manualForm.outTime && manualForm.outTime <= manualForm.inTime) {
      setManualError('เวลาออกงานต้องหลังเวลาเข้างาน')
      return
    }

    setProcessing(true)
    try {
      const checkIn = new Date(`${manualForm.date}T${manualForm.inTime}:00+07:00`).toISOString()
      const checkOut = manualForm.outTime
        ? new Date(`${manualForm.date}T${manualForm.outTime}:00+07:00`).toISOString()
        : null

      const { error } = await supabase.from('attendance_logs').insert({
        employee_id: session.user.employeeId,
        site_location_id: null,
        check_in: checkIn,
        check_out: checkOut,
        note: manualForm.note || null,
        is_manual: true,
        is_outside_geofence: true,
        manual_location: manualForm.location.trim(),
      })
      if (error) throw error

      // แจ้งแอดมินว่ามีการบันทึกย้อนหลังนอกพื้นที่
      fetch('/api/notify/manual-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: session.user.employeeName || 'พนักงาน',
          date: manualForm.date,
          location: manualForm.location.trim(),
          inTime: manualForm.inTime,
          outTime: manualForm.outTime || null,
        }),
      }).catch(() => {})

      setManualDone('บันทึกย้อนหลังเรียบร้อย (ระบบแจ้งแอดมินและกำกับว่าทำนอกพื้นที่)')
      setManualForm({ date: '', inTime: '', outTime: '', location: '', note: '' })
      setManualMode(false)
      await fetchData()
    } catch (e) {
      console.error('manual attendance error:', e)
      setManualError('บันทึกย้อนหลังไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setProcessing(false)
    }
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

      <div className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-4">

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

        {actionError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{actionError}</p>
          </div>
        )}

        {/* Active log - รออยู่ระหว่างเช็คอิน */}
        {activeLog && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800 mb-2">กำลังทำงานอยู่</p>
            <p className="text-sm text-gray-700">📍 {activeLog.site_location?.name || activeLog.manual_location || 'ไม่ระบุสถานที่'}</p>
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

            {/* selfie ตอนเช็คอิน */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">รูปเซลฟี่ตอนเช็คอิน (แนะนำ)</p>
              {selfiePreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selfiePreview} alt="selfie" className="w-full h-48 object-cover rounded-xl border border-gray-200" />
                  <label className="absolute bottom-2 right-2 bg-white/90 text-gray-700 text-xs px-3 py-2 rounded-lg border border-gray-200 cursor-pointer min-h-11 inline-flex items-center">
                    ถ่ายใหม่
                    <input type="file" accept="image/*" capture="user" onChange={onSelfieChange} className="hidden" />
                  </label>
                </div>
              ) : (
                <label className="w-full border-2 border-dashed border-gray-300 rounded-xl py-6 flex flex-col items-center justify-center text-gray-400 cursor-pointer min-h-24">
                  <span className="text-3xl">📷</span>
                  <span className="text-sm mt-1">แตะเพื่อถ่ายรูป</span>
                  <input type="file" accept="image/*" capture="user" onChange={onSelfieChange} className="hidden" />
                </label>
              )}
            </div>

            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-11 text-sm text-gray-800"
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

        {/* บันทึกย้อนหลัง / กรอกเอง */}
        {manualDone && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <p className="text-green-700 text-sm">{manualDone}</p>
          </div>
        )}
        {!manualMode ? (
          <button
            onClick={() => { setManualMode(true); setManualError(''); setManualDone(''); setManualForm(f => ({ ...f, date: today })) }}
            className="w-full bg-white border border-gray-200 rounded-xl py-3 min-h-11 text-sm text-gray-600 flex items-center justify-center gap-2"
          >
            🕐 ลืมเช็คอิน/เอาท์? บันทึกย้อนหลัง
          </button>
        ) : (
          <div className="bg-white rounded-xl p-4 border border-amber-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-800 text-sm">บันทึกย้อนหลัง (กรอกเอง)</p>
              <button onClick={() => setManualMode(false)} className="text-gray-400 text-sm min-h-11 px-2">ปิด</button>
            </div>
            <div className="bg-amber-50 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700">
                ใช้เมื่อออกไซต์ด่วนแล้วลืมเช็คอิน/เอาท์ ระบบจะกำกับว่าเป็นการบันทึกย้อนหลัง
                นอกพื้นที่ที่กำหนด และแจ้งแอดมินให้ตรวจสอบ
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
              <input
                type="date"
                value={manualForm.date}
                max={today}
                onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เวลาเข้า</label>
                <input
                  type="time"
                  value={manualForm.inTime}
                  onChange={e => setManualForm(f => ({ ...f, inTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เวลาออก (ถ้ามี)</label>
                <input
                  type="time"
                  value={manualForm.outTime}
                  onChange={e => setManualForm(f => ({ ...f, outTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานที่ทำงาน</label>
              <input
                type="text"
                value={manualForm.location}
                onChange={e => setManualForm(f => ({ ...f, location: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-gray-800"
                placeholder="เช่น ไซต์หาดใหญ่, ออฟฟิศ, บ้านลูกค้า"
              />
            </div>

            <input
              type="text"
              value={manualForm.note}
              onChange={e => setManualForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 min-h-11 text-sm text-gray-800"
              placeholder="หมายเหตุ (ถ้ามี)"
            />

            {manualError && <p className="text-red-500 text-sm">{manualError}</p>}

            <button
              onClick={handleManualEntry}
              disabled={processing}
              className="w-full bg-amber-500 text-white rounded-xl py-3 min-h-11 font-semibold disabled:opacity-50"
            >
              {processing ? 'กำลังบันทึก...' : 'บันทึกย้อนหลัง'}
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
                        ครั้งที่ {todayLogs.length - idx} · {log.site_location?.name || log.manual_location || 'ไม่ระบุสถานที่'}
                      </p>
                      {(log.is_manual || log.is_outside_geofence) && (
                        <span className="inline-block text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full mt-0.5">
                          ⚠️ บันทึกย้อนหลัง · นอกพื้นที่
                        </span>
                      )}
                      <div className="flex gap-4 mt-1 text-xs">
                        <span className="text-green-600">เข้า {formatTime(log.check_in)}</span>
                        {log.check_out
                          ? <span className="text-gray-500">ออก {formatTime(log.check_out)}</span>
                          : <span className="text-orange-500">ยังไม่เช็คเอาท์</span>}
                        {log.check_out && (
                          <span className="text-gray-400">{calcDuration(log.check_in, log.check_out)}</span>
                        )}
                      </div>
                      {log.note && <p className="text-xs text-gray-400 mt-0.5">{log.note}</p>}
                    </div>
                    {log.selfie_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={log.selfie_url} alt="selfie" className="w-12 h-12 rounded-lg object-cover border border-gray-100 ml-2 shrink-0" />
                    )}
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

      <BottomNav />
    </div>
  )
}