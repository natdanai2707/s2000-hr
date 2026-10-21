import 'server-only'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { analysisEnabled, anthropicClient, CLAUDE_MODEL, describeApiError } from '@/lib/anthropic'

// ให้ Claude อ่านรูปหรือ PDF ของใบสั่งซื้อ ใบเสนอราคา ใบกำกับภาษี หรือใบเสร็จ แล้วจับคู่แต่ละบรรทัดกับรายการ BOQ
//
// ตัวเลขในเอกสารต้องให้ Claude อ่านจากรูป (ไม่มีทางอื่น) แต่ Claude ไม่คำนวณเอง
// โค้ดใน review.ts ตรวจว่าปริมาณ × ราคา = ยอดบรรทัด และยอดรวมกับ VAT ตรงกัน ถ้าอ่านเลขผิดจะถูกเตือน
// ผู้ใช้ตรวจทุกบรรทัดในฟอร์มก่อนกดบันทึกเสมอ

const Line = z.object({
  description: z.string().describe('ชื่อสินค้าหรืองานตามที่เขียนในเอกสาร'),
  qty: z.number().nullable().describe('ปริมาณตามที่พิมพ์ในเอกสาร null ถ้าอ่านไม่ออก'),
  unit: z.string().nullable().describe('หน่วยตามเอกสาร เช่น เส้น แผ่น กก. ชุด'),
  unit_price: z.number().nullable().describe('ราคาต่อหน่วยตามที่พิมพ์ ห้ามคำนวณเอง null ถ้าไม่มีหรืออ่านไม่ออก'),
  line_total: z.number().nullable().describe('จำนวนเงินของบรรทัดตามที่พิมพ์ ห้ามคำนวณเอง'),
  boq_index: z.number().int().nullable().describe('เลข [n] ของรายการ BOQ ที่ตรงกับบรรทัดนี้ null ถ้าไม่ตรงรายการใดเลย'),
  qty_factor: z
    .number()
    .nullable()
    .describe('ถ้าหน่วยในเอกสารต่างจากหน่วยของรายการ BOQ: จำนวนหน่วย BOQ ต่อหนึ่งหน่วยในเอกสาร หาจากข้อมูลในชื่อรายการเท่านั้น null ถ้าหน่วยเดียวกันหรือไม่แน่ใจ'),
  match_note: z.string().nullable().describe('เหตุผลสั้นๆ ถ้าการจับคู่หรือตัวแปลงหน่วยไม่ชัดเจน'),
})

const DocSchema = z.object({
  is_purchase_document: z.boolean().describe('true ถ้าเป็นใบสั่งซื้อ ใบเสนอราคา ใบกำกับภาษี ใบส่งของ หรือใบเสร็จที่มีรายการสินค้าและราคา'),
  supplier_name: z.string().nullable().describe('ชื่อผู้ขาย (ไม่ใช่ชื่อบริษัทผู้ซื้อ เอส-2000)'),
  document_no: z.string().nullable(),
  job_reference: z.string().nullable().describe('เลขงานหรือ JOB ที่พิมพ์ในเอกสาร เช่น A6910-05(V100) / 6492 ตามที่เห็นทุกตัวอักษร null ถ้าไม่มี'),
  project_index: z
    .number()
    .int()
    .nullable()
    .describe('เลข [n] ของโครงการในรายการโครงการที่ตรงกับเลขงานหรือชื่องานในเอกสาร null ถ้าไม่ตรงหรือไม่แน่ใจ'),
  document_date: z.string().nullable().describe('วันที่เอกสารแบบ YYYY-MM-DD ปี ค.ศ. ถ้าเอกสารเป็น พ.ศ. ให้ลบ 543'),
  prices_include_vat: z.boolean().describe('ราคาต่อหน่วยและจำนวนเงินรายบรรทัดในเอกสารรวม VAT แล้วหรือไม่'),
  subtotal: z.number().nullable().describe('ยอดรวมรายการก่อนส่วนลดและ VAT ตามที่พิมพ์'),
  discount: z.number().nullable().describe('ส่วนลดท้ายบิล เป็นจำนวนบวก'),
  vat: z.number().nullable(),
  grand_total: z.number().nullable().describe('ยอดสุทธิที่ต้องจ่าย'),
  lines: z.array(Line),
  warnings: z.array(z.string()).describe('ข้อสังเกตภาษาไทยสั้นๆ เช่น ตัวเลขบางช่องไม่ชัด ไม่เกิน 4 ข้อ'),
})

export type ExtractedDoc = z.infer<typeof DocSchema>

export interface BoqChoice {
  description: string
  unit: string | null
}

export interface ProjectChoice {
  code: string
  name: string
}

export type ExtractOutcome = { status: 'ok'; doc: ExtractedDoc } | { status: 'off' } | { status: 'failed'; reason: string }

const SYSTEM = `คุณคือผู้ช่วยอ่านเอกสารจัดซื้อของบริษัทรับเหมางานเหล็ก เอส-2000 สตีล แฟบริเคท

หน้าที่ของคุณคือ อ่านรายการสินค้าในเอกสาร แล้วจับคู่แต่ละบรรทัดกับรายการใน BOQ ของโครงการที่ให้ไป

กติกาที่ต้องยึด
1. อ่านตัวเลขตามที่พิมพ์ในเอกสารเท่านั้น ห้ามคำนวณหรือเติมตัวเลขที่ไม่มีในเอกสาร ช่องไหนอ่านไม่ออกให้ null
   ระบบจะเอาตัวเลขไปตรวจการคูณการบวกเอง ถ้าคุณแต่งตัวเลขขึ้นมา การตรวจจะจับความผิดไม่ได้
2. ตัวเลขเป็นตัวเลขล้วน ไม่มีลูกน้ำ ทศนิยมตามที่พิมพ์
3. จับคู่กับ BOQ จากความหมายของสินค้า ไม่ต้องตรงทุกตัวอักษร เช่น ขนาดและสเปกเดียวกันแต่เขียนต่างกัน
   ถ้าไม่มีรายการไหนตรงจริง ให้ boq_index เป็น null อย่าเลือกรายการที่แค่คล้าย
4. หน่วยในเอกสารอาจต่างจาก BOQ เช่น BOQ คิดเหล็กเป็นกิโล แต่ร้านขายเป็นเส้น
   qty_factor คือจำนวนหน่วย BOQ ต่อหนึ่งหน่วยในเอกสาร หาได้จากข้อมูลในชื่อรายการ เช่น 49.9 kg/m ยาว 6 m = 299.4 kg ต่อเส้น
   ถ้าหาไม่ได้จากข้อมูลที่เห็น ให้ null และบอกใน match_note
5. ราคาในเอกสารไทยอาจรวม VAT หรือไม่รวม ดูจากหัวคอลัมน์และท้ายบิล ถ้าท้ายบิลมีบรรทัด VAT แยก แปลว่าราคารายการไม่รวม VAT
6. บรรทัดค่าขนส่งหรือค่าบริการให้ใส่เป็นรายการด้วย
7. เอกสารของเอส-2000 มักมีช่อง JOB หรือเลขงาน เช่น A6910-05(V100) ให้ใส่ใน job_reference ตามที่พิมพ์
   แล้วเลือกโครงการที่เลขงานตรงกันใน project_index ถ้าไม่มีเลขงาน ดูจากชื่องานหรือสถานที่ในหมายเหตุ ถ้าไม่แน่ใจให้ null`

function boqList(items: BoqChoice[]): string {
  return items
    .slice(0, 400)
    .map((it, i) => `[${i}] ${it.description.replace(/\s+/g, ' ').slice(0, 140)} | หน่วย ${it.unit ?? '-'}`)
    .join('\n')
}

function projectList(projects: ProjectChoice[]): string {
  return projects
    .slice(0, 200)
    .map((p, i) => `[${i}] ${p.code} | ${p.name.replace(/\s+/g, ' ').slice(0, 140)}`)
    .join('\n')
}

// boq ว่าง = ยังไม่รู้โครงการ อ่านเอกสารและเลขงานก่อน แล้วจับคู่กับ BOQ ทีหลังด้วย matchLinesToBoq
export async function extractPurchaseDocument(
  file: { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf' },
  boq: BoqChoice[],
  projects: ProjectChoice[] = []
): Promise<ExtractOutcome> {
  if (!analysisEnabled()) return { status: 'off' }
  try {
    const source =
      file.mediaType === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } } as const)
        : ({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } } as const)
    const response = await anthropicClient().beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(DocSchema) },
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              text: [
                `รายการโครงการ\n${projectList(projects) || '(ไม่มี)'}`,
                boq.length
                  ? `รายการ BOQ ของโครงการที่ผู้ใช้เลือก\n${boqList(boq)}\n\nอ่านเอกสารนี้แล้วจับคู่กับรายการ BOQ ด้านบน`
                  : 'ผู้ใช้ยังไม่ได้เลือกโครงการ อ่านเอกสารนี้ หาเลขงานและโครงการ ให้ boq_index และ qty_factor เป็น null ทุกบรรทัด',
              ].join('\n\n'),
            },
          ],
        },
      ],
    })
    if (response.stop_reason === 'refusal') return { status: 'failed', reason: 'Claude ปฏิเสธการอ่านเอกสารนี้' }
    if (response.stop_reason === 'max_tokens') return { status: 'failed', reason: 'เอกสารยาวเกินกำหนด ลองแยกเป็นหลายรูป' }
    const doc = response.parsed_output
    if (!doc) return { status: 'failed', reason: 'อ่านคำตอบไม่ได้' }
    return { status: 'ok', doc }
  } catch (e) {
    console.error('อ่านเอกสารจัดซื้อไม่สำเร็จ:', e)
    return { status: 'failed', reason: describeApiError(e) }
  }
}

const MatchSchema = z.object({
  lines: z.array(
    z.object({
      line_index: z.number().int().describe('เลข [n] ของบรรทัดในเอกสาร'),
      boq_index: Line.shape.boq_index,
      qty_factor: Line.shape.qty_factor,
      match_note: Line.shape.match_note,
    })
  ),
})

export type MatchOutcome = { status: 'ok'; matches: z.infer<typeof MatchSchema>['lines'] } | { status: 'off' } | { status: 'failed'; reason: string }

// จับคู่บรรทัดที่อ่านจากเอกสารแล้วกับ BOQ ของโครงการที่หาได้จากเลขงาน ส่งเฉพาะข้อความ ไม่ส่งรูปซ้ำ
export async function matchLinesToBoq(lines: { description: string; unit: string | null }[], boq: BoqChoice[]): Promise<MatchOutcome> {
  if (!analysisEnabled()) return { status: 'off' }
  try {
    const docLines = lines.map((l, i) => `[${i}] ${l.description.replace(/\s+/g, ' ').slice(0, 160)} | หน่วย ${l.unit ?? '-'}`).join('\n')
    const response = await anthropicClient().beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(MatchSchema) },
      messages: [
        {
          role: 'user',
          content: `รายการ BOQ ของโครงการนี้\n${boqList(boq) || '(ไม่มี)'}\n\nบรรทัดที่อ่านจากเอกสารจัดซื้อ\n${docLines}\n\nจับคู่ทุกบรรทัดในเอกสารกับรายการ BOQ ด้านบน`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') return { status: 'failed', reason: 'Claude ปฏิเสธการจับคู่รายการ' }
    if (response.stop_reason === 'max_tokens') return { status: 'failed', reason: 'รายการยาวเกินกำหนด' }
    const out = response.parsed_output
    if (!out) return { status: 'failed', reason: 'อ่านคำตอบไม่ได้' }
    return { status: 'ok', matches: out.lines }
  } catch (e) {
    console.error('จับคู่รายการกับ BOQ ไม่สำเร็จ:', e)
    return { status: 'failed', reason: describeApiError(e) }
  }
}
