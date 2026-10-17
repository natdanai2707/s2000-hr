import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { analyzeSheet } from '@/lib/boq/analyze'

// เซิร์ฟเวอร์จำลอง API: เก็บ request ที่ SDK ส่งจริง แล้วตอบผลวิเคราะห์ตายตัว
// ตรวจทางเดินทั้งหมดตั้งแต่สร้าง request จนแปลงคำตอบ โดยไม่ต้องใช้ API จริง
let server: http.Server
let last: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null
let reply: { status: number; body: unknown } = { status: 200, body: {} }
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL }

const analysis = {
  is_boq_detail_sheet: true,
  sheet_kind: 'boq_detail',
  header_row: 1,
  header_row_count: 1,
  data_start_row: 2,
  columns: { item_no: null, description: 0, unit: 2, qty: 1, material_price: 3, labor_price: null, total: 4, markup_pct: null, material_total: null, labor_total: null, unit_rate: null },
  summary_rows: [{ row: 4, kind: 'sub_total' }],
  contract_value_cell: { row: 4, column: 4, includes_vat: false },
  confidence: 'high',
  warnings: [],
}
const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 },
})

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      last = { headers: req.headers, body: JSON.parse(raw) }
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.body))
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

const grid: unknown[][] = [
  ['รายการ', 'ปริมาณ', 'หน่วย', 'ราคา', 'รวม'],
  ['รางสแตนเลส', 40, 'ม.', 1000, { formula: 'B2*D2', result: 40000 }],
  ['ท่อลง', 6, 'ชุด', 1500, { formula: 'B3*D3', result: 9000 }],
  ['Sub Total', '', '', '', { formula: 'SUM(E2:E3)', result: 49000 }],
]

describe('เรียก Claude อ่านโครงชีต', () => {
  it('ส่ง request ถูกรูปแบบ และแปลงคำตอบเป็นผลวิเคราะห์ได้', async () => {
    reply = { status: 200, body: message(JSON.stringify(analysis)) }
    const out = await analyzeSheet('BOQ', grid)
    expect(out.status).toBe('ok')
    if (out.status !== 'ok') return
    expect(out.result.mapping).toMatchObject({ description: 0, qty: 1, material_price: 3, total: 4 })
    expect(out.result.roles.get(4)).toBe('sub_total')
    expect(out.result.contract_cell).toEqual({ row: 4, column: 4, includes_vat: false })

    const body = last!.body
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.fallbacks).toBe('default')
    expect(String(last!.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    expect(body).not.toHaveProperty('thinking')
    const format = (body.output_config as { format: { type: string; schema: Record<string, unknown> } }).format
    expect(format.type).toBe('json_schema')
    // ตัวเลขจากสูตรต้องถึง Claude
    const content = JSON.stringify(body.messages)
    expect(content).toContain('49000')
    expect(content).not.toContain('[object Object]')
  })

  it('เครดิตหมดหรือ API ตอบผิดพลาดอื่น บอกรหัสและข้อความจริง', async () => {
    reply = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } } }
    const out = await analyzeSheet('BOQ', grid)
    expect(out.status === 'failed' && out.reason).toContain('credit balance is too low')
  })

  it('API ตอบ key ผิด บอกสาเหตุให้ผู้ใช้เห็น', async () => {
    reply = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }
    await expect(analyzeSheet('BOQ', grid)).resolves.toEqual({ status: 'failed', reason: 'API key ไม่ถูกต้อง' })
  })

  it('ถูกปฏิเสธ ไม่อ่านผลที่ไม่ครบ', async () => {
    reply = { status: 200, body: message('', 'refusal') }
    const out = await analyzeSheet('BOQ', grid)
    expect(out.status).toBe('failed')
    if (out.status === 'failed') expect(out.reason).not.toBe('เชื่อมต่อ API ไม่ได้')
  })
})
