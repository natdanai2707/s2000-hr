'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface SiteLocation {
  id: string
  name: string
  project_id: string | null
  latitude: number
  longitude: number
  radius_meters: number
  is_active: boolean
  project?: { project_code: string; project_name: string }
}

interface Project {
  id: string
  project_code: string
  project_name: string
}

export default function SiteManagePage() {
  const router = useRouter()
  const [sites, setSites] = useState<SiteLocation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteLocation | null>(null)
  const [getting, setGetting] = useState(false)
  const [form, setForm] = useState({
    name: '',
    project_id: '',
    latitude: '',
    longitude: '',
    radius_meters: '200',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: sitesData } = await supabase
      .from('site_locations')
      .select('*, project:projects(project_code, project_name)')
      .order('name')
    setSites(sitesData || [])

    const { data: projectsData } = await supabase
      .from('projects')
      .select('id, project_code, project_name')
      .eq('is_active', true)
      .order('project_code')
    setProjects(projectsData || [])
  }

  function handleEdit(site: SiteLocation) {
    setEditingSite(site)
    setForm({
      name: site.name,
      project_id: site.project_id || '',
      latitude: site.latitude.toString(),
      longitude: site.longitude.toString(),
      radius_meters: site.radius_meters.toString(),
    })
    setShowForm(true)
  }

  function handleNew() {
    setEditingSite(null)
    setForm({ name: '', project_id: '', latitude: '', longitude: '', radius_meters: '200' })
    setShowForm(true)
  }

  function getCurrentLocation() {
    setGetting(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(7),
          longitude: pos.coords.longitude.toFixed(7),
        }))
        setGetting(false)
      },
      () => {
        alert('ไม่สามารถดึง GPS ได้')
        setGetting(false)
      },
      { enableHighAccuracy: true }
    )
  }

  async function handleSubmit() {
    if (!form.name || !form.latitude || !form.longitude) return
    setSubmitting(true)

    const payload = {
      name: form.name,
      project_id: form.project_id || null,
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      radius_meters: parseInt(form.radius_meters) || 200,
    }

    if (editingSite) {
      await supabase.from('site_locations').update(payload).eq('id', editingSite.id)
    } else {
      await supabase.from('site_locations').insert(payload)
    }

    await fetchData()
    setShowForm(false)
    setSubmitting(false)
  }

  async function toggleActive(site: SiteLocation) {
    await supabase.from('site_locations').update({ is_active: !site.is_active }).eq('id', site.id)
    await fetchData()
  }

  if (showForm) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
          <button onClick={() => setShowForm(false)} className="text-gray-400">←</button>
          <h1 className="font-semibold text-gray-800">{editingSite ? 'แก้ไขไซต์งาน' : 'เพิ่มไซต์งาน'}</h1>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อไซต์งาน *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              placeholder="เช่น ไซต์หาดใหญ่ สถานีรถไฟ"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">โปรเจกต์ (ถ้ามี)</label>
            <select
              value={form.project_id}
              onChange={e => setForm({ ...form, project_id: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800 bg-white"
            >
              <option value="">ไม่ระบุ</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.project_code} · {p.project_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">พิกัด GPS *</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="number"
                value={form.latitude}
                onChange={e => setForm({ ...form, latitude: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="Latitude"
                step="0.0000001"
              />
              <input
                type="number"
                value={form.longitude}
                onChange={e => setForm({ ...form, longitude: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
                placeholder="Longitude"
                step="0.0000001"
              />
            </div>
            <button
              onClick={getCurrentLocation}
              disabled={getting}
              className="w-full border border-blue-500 text-blue-600 rounded-lg py-2 text-sm hover:bg-blue-50 transition"
            >
              {getting ? 'กำลังดึง GPS...' : '📍 ใช้ตำแหน่งปัจจุบัน'}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รัศมีเช็คอิน (เมตร)</label>
            <input
              type="number"
              value={form.radius_meters}
              onChange={e => setForm({ ...form, radius_meters: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-gray-800"
              min={50}
              max={2000}
              step={50}
            />
            <p className="text-xs text-gray-400 mt-1">แนะนำ 100-300 เมตร สำหรับไซต์ก่อสร้าง</p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium disabled:opacity-50"
          >
            {submitting ? 'กำลังบันทึก...' : editingSite ? 'บันทึกการแก้ไข' : 'เพิ่มไซต์งาน'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400">←</button>
          <h1 className="font-semibold text-gray-800">จัดการไซต์งาน</h1>
        </div>
        <button
          onClick={handleNew}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg"
        >
          + เพิ่มไซต์
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {sites.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-gray-400">
            ยังไม่มีไซต์งาน
          </div>
        ) : (
          sites.map(site => (
            <div key={site.id} className={`bg-white rounded-xl p-4 border ${site.is_active ? 'border-gray-100' : 'border-gray-200 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-800">{site.name}</p>
                  {(site as any).project && (
                    <p className="text-xs text-gray-400">{(site as any).project.project_name}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {site.latitude}, {site.longitude} · รัศมี {site.radius_meters} ม.
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${site.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {site.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0 ml-2">
                  <button
                    onClick={() => handleEdit(site)}
                    className="text-xs text-blue-500 border border-blue-200 px-2 py-1 rounded-lg"
                  >
                    แก้ไข
                  </button>
                  <button
                    onClick={() => toggleActive(site)}
                    className="text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg"
                  >
                    {site.is_active ? 'ปิด' : 'เปิด'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}