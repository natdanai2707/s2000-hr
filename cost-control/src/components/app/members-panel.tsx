'use client'

import { useState } from 'react'
import { addProjectMember, removeProjectMember } from '@/actions/projects'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'

interface Member {
  user_id: string
  full_name: string
  role: string
  role_label: string
  role_in_project: string | null
}

export function MembersPanel({
  projectId,
  canManage,
  members,
  candidates,
}: {
  projectId: string
  canManage: boolean
  members: Member[]
  candidates: { id: string; full_name: string; role_label: string }[]
}) {
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const available = candidates.filter(c => !members.some(m => m.user_id === c.id))

  async function add() {
    if (!selected) return
    setPending(true)
    setError(null)
    const res = await addProjectMember(projectId, selected, 'member')
    setPending(false)
    if (!res.ok) setError(res.error)
    else setSelected('')
  }

  async function remove(userId: string) {
    setPending(true)
    const res = await removeProjectMember(projectId, userId)
    setPending(false)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {error && <div className="p-3"><Alert tone="danger">{error}</Alert></div>}
      {members.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">ยังไม่มีสมาชิก</p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map(m => (
            <li key={m.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <div className="font-medium">{m.full_name}</div>
                <div className="text-xs text-muted-foreground">{m.role_label}</div>
              </div>
              {canManage && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(m.user_id)}>
                  นำออก
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex gap-2 p-3 border-t border-border">
          <Select value={selected} onChange={e => setSelected(e.target.value)} className="flex-1">
            <option value="">เลือกผู้ใช้</option>
            {available.map(c => (
              <option key={c.id} value={c.id}>
                {c.full_name} ({c.role_label})
              </option>
            ))}
          </Select>
          <Button onClick={add} disabled={!selected || pending}>เพิ่ม</Button>
        </div>
      )}
    </div>
  )
}
