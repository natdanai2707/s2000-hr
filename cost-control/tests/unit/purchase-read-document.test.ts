import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPurchaseDocument } from '@/lib/purchase/read-document'

// แนบหลายใบคละงาน: แต่ละใบหาโครงการจากเลข JOB เอง ทดสอบด้วย API ของ Claude จำลอง และ Supabase จำลอง
let server: http.Server
const calls: Record<string, unknown>[] = []
let replies: unknown[] = []
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL }

const message = (obj: unknown) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1, output_tokens: 1 },
})

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      calls.push(JSON.parse(raw))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(message(replies.shift())))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  process.env.ANTHROPIC_API_KEY = 'test-key'
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.close()
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = saved.key
  if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = saved.url
})

const projects = [
  { project_id: 'p1', code: 'A6910-04', name: 'งานหลังคา หลังที่ 1 (V099)', confirmed_version_id: 'v1' },
  { project_id: 'p2', code: 'A6910-05', name: 'งานหลังคา หลังที่ 2 (V100)', confirmed_version_id: 'v2' },
]
const boq: Record<string, { id: string; description: string; unit: string }[]> = {
  v1: [{ id: 'b1', description: 'Roof TS76029 Zincalume 0.47', unit: 'm2' }],
  v2: [
    { id: 'b2', description: 'Roof TS76029 Zincalume 0.47', unit: 'm2' },
    { id: 'b3', description: 'Flashing Zincalume 0.47 Girth<626', unit: 'm.' },
  ],
}
let uploads: string[] = []

// Supabase จำลองเฉพาะคำสั่งที่โมดูลนี้ใช้
function fakeSupabase(): SupabaseClient {
  const query = (table: string) => {
    let version = ''
    const q = {
      select: () => q,
      in: () => q,
      not: () => q,
      gte: () => q,
      eq: (_c: string, v: string) => ((version = v), q),
      order: () => q,
      then: (resolve: (v: unknown) => void) => resolve({ data: table === 'v_project_summary' ? projects : boq[version] ?? [] }),
    }
    return q
  }
  return {
    from: query,
    storage: { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }) }) },
  } as unknown as SupabaseClient
}

const doc = (job: string | null) => ({
  is_purchase_document: true, supplier_name: 'บริษัท ไทยสุราษฎร์สตีล จำกัด', document_no: 'PB6910109', job_reference: job, project_index: null,
  document_date: '2026-10-20', prices_include_vat: false, subtotal: 204525.88, discount: 0, vat: 14316.81, grand_total: 218842.69,
  lines: [
    { description: 'Roof:TS76029 Zincalume 0.47 TCT.G550,AZ150', qty: 769.88, unit: 'M2', unit_price: 251, line_total: 193239.88, boq_index: null, qty_factor: null, match_note: null },
    { description: 'Flashing,Zincalume,AZ150,0.47mm.BHP.,Girth<626', qty: 59.4, unit: 'M.', unit_price: 190, line_total: 11286, boq_index: null, qty_factor: null, match_note: null },
  ],
  warnings: [],
})
const file = () => new File([new Uint8Array([1, 2, 3])], 'po.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  calls.length = 0
  uploads = []
})

describe('อ่านเอกสารจัดซื้อโดยยังไม่เลือกโครงการ', () => {
  it('เลือกโครงการจากเลข JOB แล้วจับคู่ BOQ ด้วยข้อความ แนบไฟล์ไว้กับโครงการนั้น', async () => {
    replies = [doc('A6910-05(V100) / 6492'), { lines: [{ line_index: 0, boq_index: 0, qty_factor: 1, match_note: null }, { line_index: 1, boq_index: 1, qty_factor: 1, match_note: null }] }]
    const r = await readPurchaseDocument(fakeSupabase(), { file: file(), projectId: null, candidateIds: ['p1', 'p2'], doc: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.project_id).toBe('p2')
    expect(r.data.lines.map(l => l.boq_item_id)).toEqual(['b2', 'b3'])
    expect(r.data.issues).toEqual([])
    expect(r.data.notes[0]).toContain('A6910-05')
    expect(uploads[0]).toMatch(/^projects\/p2\/purchases\//)
    expect(calls).toHaveLength(2)
    expect(typeof (calls[1].messages as { content: unknown }[])[0].content).toBe('string')
  })

  it('หาโครงการไม่ได้ คืนเอกสารที่อ่านแล้วให้ผู้ใช้เลือกโครงการ ยังไม่อัปโหลด', async () => {
    replies = [doc(null)]
    const r = await readPurchaseDocument(fakeSupabase(), { file: file(), projectId: null, candidateIds: ['p1', 'p2'], doc: null })
    expect(r.ok && r.data.project_id).toBeNull()
    expect(r.ok && r.data.unassigned_doc?.lines).toHaveLength(2)
    expect(uploads).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('ผู้ใช้เลือกโครงการให้เอกสารที่อ่านแล้ว จับคู่ BOQ โดยไม่ส่งรูปให้ Claude อ่านซ้ำ', async () => {
    replies = [{ lines: [{ line_index: 0, boq_index: 0, qty_factor: 1, match_note: null }] }]
    const r = await readPurchaseDocument(fakeSupabase(), { file: file(), projectId: 'p1', candidateIds: [], doc: doc(null) })
    expect(r.ok && r.data.lines.map(l => l.boq_item_id)).toEqual(['b1', null])
    expect(calls).toHaveLength(1)
    expect(typeof (calls[0].messages as { content: unknown }[])[0].content).toBe('string')
    expect(uploads[0]).toMatch(/^projects\/p1\/purchases\//)
  })

  it('เลือกโครงการไว้แล้วแต่เลข JOB เป็นของอีกงาน เตือนแต่ไม่เปลี่ยนโครงการ', async () => {
    replies = [{ ...doc('A6910-05(V100)'), lines: doc(null).lines.map(l => ({ ...l, boq_index: 0, qty_factor: 1 })) }]
    const r = await readPurchaseDocument(fakeSupabase(), { file: file(), projectId: 'p1', candidateIds: ['p1', 'p2'], doc: null })
    expect(r.ok && r.data.project_id).toBe('p1')
    expect(r.ok && r.data.warnings[0]).toContain('A6910-05 งานหลังคา หลังที่ 2')
    expect(calls).toHaveLength(1)
  })
})
