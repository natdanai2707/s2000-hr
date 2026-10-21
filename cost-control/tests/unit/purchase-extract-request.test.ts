import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { extractPurchaseDocument, matchLinesToBoq } from '@/lib/purchase/extract'

// เซิร์ฟเวอร์จำลอง API: ตรวจ request ที่ส่งรูปเอกสารไปให้ Claude อ่าน โดยไม่ต้องใช้ API จริง
let server: http.Server
let last: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null
let reply: { status: number; body: unknown } = { status: 200, body: {} }
const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL }

const doc = {
  is_purchase_document: true, supplier_name: 'บจก.เหล็กใต้', document_no: 'PO-001', job_reference: null, project_index: null, document_date: '2026-10-17',
  prices_include_vat: false, subtotal: 90000, discount: null, vat: 6300, grand_total: 96300,
  lines: [{ description: 'H-BEAM 200x200', qty: 10, unit: 'เส้น', unit_price: 9000, line_total: 90000, boq_index: 0, qty_factor: null, match_note: null }],
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

const boq = [{ description: 'เหล็ก H-BEAM (49.9 kg/m) Size 6 m.', unit: 'kg' }]

describe('ส่งรูปเอกสารจัดซื้อให้ Claude อ่าน', () => {
  it('ส่งรูปก่อนข้อความ พร้อมรายการ BOQ และแปลงคำตอบได้', async () => {
    reply = { status: 200, body: message(JSON.stringify(doc)) }
    const out = await extractPurchaseDocument({ data: 'AAAA', mediaType: 'image/jpeg' }, boq)
    expect(out.status).toBe('ok')
    if (out.status === 'ok') expect(out.doc.lines[0]).toMatchObject({ qty: 10, unit_price: 9000, boq_index: 0 })
    const body = last!.body
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.fallbacks).toBe('default')
    const content = (body.messages as { content: { type: string; source?: { media_type: string }; text?: string }[] }[])[0].content
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } })
    expect(content[1].text).toContain('[0] เหล็ก H-BEAM (49.9 kg/m) Size 6 m. | หน่วย kg')
  })

  it('PDF ส่งเป็น document', async () => {
    reply = { status: 200, body: message(JSON.stringify(doc)) }
    await extractPurchaseDocument({ data: 'AAAA', mediaType: 'application/pdf' }, boq)
    const content = (last!.body.messages as { content: { type: string }[] }[])[0].content
    expect(content[0].type).toBe('document')
  })

  it('ไม่มี API key หรือ API ปฏิเสธ บอกสถานะให้ผู้เรียกรู้ ไม่โยน error', async () => {
    reply = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } } }
    const failed = await extractPurchaseDocument({ data: 'AAAA', mediaType: 'image/png' }, boq)
    expect(failed.status === 'failed' && failed.reason).toContain('credit balance is too low')
    const key = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    await expect(extractPurchaseDocument({ data: 'AAAA', mediaType: 'image/png' }, boq)).resolves.toEqual({ status: 'off' })
    process.env.ANTHROPIC_API_KEY = key
  })
})

describe('ยังไม่ได้เลือกโครงการ: หาโครงการจากเลขงานแล้วจับคู่ BOQ ทีหลัง', () => {
  it('ส่งรายการโครงการไปด้วย และบอกว่ายังไม่ต้องจับคู่ BOQ', async () => {
    reply = { status: 200, body: message(JSON.stringify({ ...doc, job_reference: 'A6910-05(V100) / 6492', project_index: 0 })) }
    const out = await extractPurchaseDocument({ data: 'AAAA', mediaType: 'image/jpeg' }, [], [{ code: 'A6910-05', name: 'งานหลังคา หลังที่ 2' }])
    expect(out.status === 'ok' && out.doc.job_reference).toBe('A6910-05(V100) / 6492')
    const text = (last!.body.messages as { content: { text?: string }[] }[])[0].content[1].text!
    expect(text).toContain('[0] A6910-05 | งานหลังคา หลังที่ 2')
    expect(text).toContain('ยังไม่ได้เลือกโครงการ')
  })

  it('จับคู่บรรทัดกับ BOQ ด้วยข้อความอย่างเดียว ไม่ส่งรูปซ้ำ', async () => {
    reply = { status: 200, body: message(JSON.stringify({ lines: [{ line_index: 0, boq_index: 0, qty_factor: 299.4, match_note: null }] })) }
    const out = await matchLinesToBoq([{ description: 'H-BEAM 200x200', unit: 'เส้น' }], boq)
    expect(out).toEqual({ status: 'ok', matches: [{ line_index: 0, boq_index: 0, qty_factor: 299.4, match_note: null }] })
    const content = (last!.body.messages as { content: unknown }[])[0].content
    expect(typeof content).toBe('string')
    expect(content).toContain('[0] H-BEAM 200x200 | หน่วย เส้น')
    expect(content).toContain('[0] เหล็ก H-BEAM (49.9 kg/m) Size 6 m. | หน่วย kg')
  })
})
