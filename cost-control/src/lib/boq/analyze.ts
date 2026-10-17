import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { cellNumber, cellText, type ColumnMapping } from './split'
import type { SheetLayout } from './layout'
import type { AiCell, SummaryKind } from './verify'

// ให้ Claude อ่านตารางแล้วบอกว่าคอลัมน์ไหนคืออะไร แทนการจับคู่ชื่อคอลัมน์ด้วยกฎตายตัว
// เหตุผล: BOQ จริงมาจากผู้ประมาณราคาหลายคน หัวคอลัมน์สะกดไม่เหมือนกัน พิมพ์ผิด
// สลับภาษาไทยอังกฤษ หรือใช้คำที่ไม่เคยเจอ กฎตายตัวพลาดแล้วนำเข้าไม่ได้ทั้งไฟล์
//
// สำคัญ: Claude ตัดสินแค่ว่าคอลัมน์ไหนคืออะไร แถวไหนเป็นยอดรวมแบบไหน และเซลล์ไหนคือมูลค่าสัญญา
// Claude ไม่เคยคำนวณหรือพิมพ์ตัวเลขเงินเอง ตัวเลขทุกตัวอ่านจากเซลล์ในไฟล์ และการคำนวณ
// รวมถึงการตรวจว่าไฟล์คูณบวกถูกหรือไม่ ทำด้วยโค้ดใน splitRows และ verifySheet
// ไฟล์เดิมจึงให้ผลเดิมทุกครั้ง และผู้ใช้ยังตรวจการจับคู่คอลัมน์ได้ก่อนกดนำเข้าจริง

const ColumnIndex = z.number().int().min(0).nullable()

const AnalysisSchema = z.object({
  is_boq_detail_sheet: z
    .boolean()
    .describe('true เฉพาะชีตที่เป็นตารางรายการงานพร้อมปริมาณและราคาต่อหน่วย ชีตปก ใบเสนอราคาสรุป สารบัญ ให้เป็น false'),
  sheet_kind: z
    .enum(['boq_detail', 'quotation_summary', 'cover', 'other'])
    .describe('ประเภทของชีตนี้'),
  header_row: z.number().int().min(1).describe('เลขแถวของหัวตาราง แถวบนสุดถ้าหัวตารางมีหลายแถว'),
  header_row_count: z.union([z.literal(1), z.literal(2)]).describe('หัวตารางกินกี่แถว'),
  data_start_row: z
    .number()
    .int()
    .min(1)
    .describe('เลขแถวแรกของข้อมูลจริง ต้องข้ามหัวกระดาษ หัวตาราง และบล็อกสรุปยอดต่อหมวดที่อยู่เหนือรายละเอียด'),
  columns: z.object({
    item_no: ColumnIndex.describe('คอลัมน์เลขลำดับหรือรหัสรายการ'),
    description: ColumnIndex.describe('คอลัมน์ชื่อรายการงาน'),
    unit: ColumnIndex.describe('คอลัมน์หน่วยนับ'),
    qty: ColumnIndex.describe('คอลัมน์ปริมาณ'),
    material_price: ColumnIndex.describe('ราคาวัสดุต่อหนึ่งหน่วย ห้ามเอาคอลัมน์ยอดรวมของบรรทัด'),
    labor_price: ColumnIndex.describe('ค่าแรงต่อหนึ่งหน่วย ห้ามเอาคอลัมน์ยอดรวมของบรรทัด'),
    total: ColumnIndex.describe('ยอดรวมเงินของบรรทัด'),
    material_total: ColumnIndex.describe('ยอดรวมค่าวัสดุของบรรทัด (ปริมาณ × ราคาวัสดุต่อหน่วย) ใช้ตรวจตัวเลข'),
    labor_total: ColumnIndex.describe('ยอดรวมค่าแรงของบรรทัด (ปริมาณ × ค่าแรงต่อหน่วย) ใช้ตรวจตัวเลข'),
    unit_rate: ColumnIndex.describe('ราคาต่อหน่วยรวม (วัสดุ + ค่าแรง ต่อหนึ่งหน่วย) ใช้ตรวจตัวเลข'),
    material_cost: ColumnIndex.describe('ต้นทุนวัสดุจริงต่อหน่วยที่ผู้ประมาณราคาทดไว้ ไม่รวม VAT มักอยู่ด้านขวานอกตารางหลัก'),
    labor_cost: ColumnIndex.describe('ต้นทุนค่าแรงจริงต่อหน่วยที่ผู้ประมาณราคาทดไว้ มักอยู่ด้านขวานอกตารางหลัก'),
    material_cost_total: ColumnIndex.describe('ต้นทุนวัสดุรวมของบรรทัด ใช้ตรวจตัวเลข'),
    labor_cost_total: ColumnIndex.describe('ต้นทุนค่าแรงรวมของบรรทัด ใช้ตรวจตัวเลข'),
    markup_pct: ColumnIndex.describe(
      'คอลัมน์เปอร์เซ็นต์กำไรหรือ markup เท่านั้น ถ้าเป็นคอลัมน์ราคาที่บังเอิญมีเครื่องหมายเปอร์เซ็นต์ในชื่อ ให้เป็น null'
    ),
  }),
  summary_rows: z
    .array(
      z.object({
        row: z.number().int().min(1),
        kind: z.enum(['section_total', 'group_total', 'sub_total', 'overhead', 'discount', 'total', 'vat', 'grand_total']),
      })
    )
    .describe(
      'ทุกแถวที่เป็นยอดรวม: section_total ยอดรวมหมวดย่อย, group_total ยอดรวมหมวดใหญ่ที่รวมหลายหมวดย่อย, sub_total ยอดรวมก่อนค่าดำเนินการ, overhead ค่าดำเนินการหรือกำไร, discount ส่วนลด, total ยอดรวมหลังบวกลบ, vat ภาษีมูลค่าเพิ่ม, grand_total ยอดรวมที่รวม VAT แล้ว'
    ),
  contract_value_cell: z
    .object({
      row: z.number().int().min(1),
      column: z.number().int().min(0),
      includes_vat: z.boolean().describe('true ถ้ายอดในเซลล์นี้รวม VAT แล้ว'),
    })
    .nullable()
    .describe(
      'เซลล์ที่เป็นมูลค่างานทั้งหมดที่เสนอลูกค้า หลังหักส่วนลด ควรเป็นยอดก่อน VAT ถ้าในชีตมี ถ้าชีตนี้ไม่มียอดแบบนี้ ให้ null'
    ),
  confidence: z.enum(['high', 'medium', 'low']),
  warnings: z
    .array(z.string())
    .describe('ข้อสังเกตเป็นภาษาไทยสั้นๆ ที่ผู้ใช้ควรรู้ เช่น พบหมวดงานลด ไม่มีคอลัมน์ค่าแรง ไม่เกิน 4 ข้อ'),
})

export type SheetAnalysis = z.infer<typeof AnalysisSchema>

export interface AnalyzeResult {
  mapping: ColumnMapping
  layout: SheetLayout
  is_boq_detail_sheet: boolean
  sheet_kind: SheetAnalysis['sheet_kind']
  confidence: SheetAnalysis['confidence']
  warnings: string[]
  roles: Map<number, SummaryKind>
  contract_cell: AiCell | null
}

// off = ไม่ได้ตั้ง ANTHROPIC_API_KEY, failed = ตั้งแล้วแต่เรียกไม่สำเร็จ (ให้ผู้ใช้เห็นสาเหตุจริง)
export type AnalyzeOutcome = { status: 'ok'; result: AnalyzeResult } | { status: 'off' } | { status: 'failed'; reason: string }

const SYSTEM = `คุณคือผู้ช่วยอ่านไฟล์ BOQ (Bill of Quantities) ของผู้รับเหมาก่อสร้างไทย

หน้าที่ของคุณคือดูตารางดิบจากชีต Excel หนึ่งชีต แล้วบอกว่าแต่ละคอลัมน์คืออะไร และข้อมูลจริงเริ่มที่แถวไหน
คุณไม่ต้องคำนวณตัวเลขใดๆ ระบบจะคำนวณเองจากการจับคู่คอลัมน์ที่คุณให้

กติกาที่ต้องยึด

1. ดูข้อมูลในเซลล์เป็นหลัก ไม่ใช่ชื่อหัวคอลัมน์อย่างเดียว เพราะชื่อหัวคอลัมน์มักสะกดต่างกันหรือพิมพ์ผิด
2. คอลัมน์ราคาวัสดุและค่าแรงที่ต้องการคือราคาต่อหนึ่งหน่วย ไม่ใช่ยอดรวมของบรรทัด
   วิธีแยก: ถ้าคอลัมน์หนึ่งมีค่าประมาณเท่ากับ ปริมาณ คูณ อีกคอลัมน์หนึ่ง คอลัมน์นั้นคือยอดรวม ไม่ใช่ราคาต่อหน่วย
   BOQ ของบริษัทนี้มักมีหัวตารางสองแถว แถวบนเขียน MATERIAL กับ LABOUR แถวล่างเขียน @ กับ SUB TOTAL
   ช่อง @ คือราคาต่อหน่วย ช่อง SUB TOTAL คือยอดรวม
3. markup_pct ต้องเป็นคอลัมน์เปอร์เซ็นต์กำไรจริงเท่านั้น ค่าในคอลัมน์ต้องดูเหมือนเปอร์เซ็นต์ เช่น 8 10 12
   ถ้าคอลัมน์ชื่อมีเครื่องหมายเปอร์เซ็นต์แต่ค่าข้างในเป็นราคาเป็นหลักพันหลักหมื่น ให้ตอบ null
4. data_start_row ต้องข้ามสามอย่าง หัวกระดาษด้านบน หัวตาราง และบล็อกสรุปยอดต่อหมวด
   บล็อกสรุปมักอยู่ใต้หัวตารางทันที มีคำว่า SUMMARY หรือมีหมวด A B C ที่หน่วยเป็น L/S แล้วตามด้วยบรรทัด Sub Total และ Total
   ถ้านำบล็อกสรุปเข้าไปด้วย ต้นทุนจะถูกนับซ้ำสองเท่า ซึ่งผิด
5. ชีตที่เป็นปกหรือใบเสนอราคาสรุปที่มีแต่ยอดรวมก้อนเดียว ให้ is_boq_detail_sheet เป็น false
   เพราะถ้านำเข้าพร้อมชีตรายละเอียดจะนับต้นทุนซ้ำ
6. เลขคอลัมน์ที่ตอบเป็นแบบเริ่มที่ 0 ตามที่แสดงในข้อมูล เลขแถวเป็นแบบเริ่มที่ 1
7. คอลัมน์ไหนไม่มีในชีต ให้ตอบ null อย่าเดา
8. summary_rows ให้ระบุทุกแถวยอดรวมที่เห็น ทั้งในบล็อกสรุปด้านบนและท้ายหมวด
   ข้อมูลอาจตัดช่วงกลางชีตออก แต่แถวที่มีคำว่ารวม total vat ส่วนลด ถูกส่งมาให้ครบพร้อมเลขแถวจริง
10. บางไฟล์มีคอลัมน์ต้นทุนจริงอยู่ด้านขวาของตาราง หัวคอลัมน์อาจอยู่ในแถวหัวหมวด ไม่ใช่แถวหัวตาราง
   เช่น "ต้นทุนวัสดุ /หน่วย" "ต้นทุนค่าแรง/หน่วย" ให้ระบุใน material_cost labor_cost
   ในไฟล์แบบนี้ ราคาวัสดุและค่าแรงในตารางหลักคือราคาขาย ไม่ใช่ต้นทุน
9. contract_value_cell คือยอดที่ลูกค้าต้องจ่ายสำหรับงานนี้ทั้งหมด หลังหักส่วนลด
   ในใบเสนอราคามักอยู่บรรทัดก่อน VAT ใน BOQ มักเป็นบรรทัด Total หลัง Overhead & Profit
   ห้ามเลือกยอดที่รวม VAT ถ้ามียอดก่อน VAT ให้เลือก และห้ามพิมพ์ตัวเลขเอง ให้ชี้เซลล์เท่านั้น`

// แสดงค่าในเซลล์เป็นข้อความ เซลล์สูตรต้องแสดงผลลัพธ์ ไม่ใช่ [object Object]
function cellDisplay(v: unknown): string {
  const n = cellNumber(v)
  if (n !== null) return String(Math.round(n * 100) / 100)
  return cellText(v).replace(/\s+/g, ' ').slice(0, 60)
}

const TOTALISH_RE = /(total|รวม|vat|ภาษี|ส่วนลด|discount|overhead|กำไร)/i

// ส่งแถวต้นชีตตาม maxRows และแถวยอดรวมทุกแถวจากส่วนที่เหลือ เพื่อให้ Claude เห็นสายยอดสรุปท้ายชีต
export function gridToText(grid: unknown[][], maxRows: number, maxCols: number): string {
  const lines: string[] = []
  const header = Array.from({ length: maxCols }, (_, c) => `c${c}`).join(' | ')
  lines.push(`แถว | ${header}`)
  let skipped = false
  for (let r = 0; r < grid.length; r++) {
    const cells: string[] = []
    for (let c = 0; c < maxCols; c++) cells.push(cellDisplay(grid[r]?.[c]))
    if (cells.every(x => x === '')) continue
    if (r >= maxRows && !cells.some(x => TOTALISH_RE.test(x))) {
      skipped = true
      continue
    }
    if (skipped) {
      lines.push('... (ตัดแถวรายการช่วงนี้ออก)')
      skipped = false
    }
    lines.push(`r${r + 1} | ${cells.join(' | ')}`)
  }
  return lines.join('\n')
}

export function analysisEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// วิเคราะห์หนึ่งชีต ผู้เรียกต้องมีทางสำรองแบบกฎตายตัวเสมอ ระบบต้องนำเข้าได้แม้ไม่มี API
export async function analyzeSheet(sheetName: string, grid: unknown[][]): Promise<AnalyzeOutcome> {
  if (!analysisEnabled()) return { status: 'off' }
  // คอลัมน์ต้นทุนของ S-2000 อยู่ถึงคอลัมน์ X จึงต้องส่งให้เห็นอย่างน้อย 26 คอลัมน์
  const maxCols = Math.min(Math.max(...grid.slice(0, 60).map(r => r.length), 1), 30)
  const table = gridToText(grid, 45, maxCols)

  try {
    // key ระดับองค์กรที่ไม่ได้ผูกกับ workspace ต้องบอก workspace ในทุกคำขอ
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
    const client = new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {})
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      // ถ้าตัวกรองความปลอดภัยปฏิเสธ ให้ API ส่งต่อไปโมเดลสำรองที่เหมาะสมเอง
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: betaZodOutputFormat(AnalysisSchema),
      },
      messages: [
        {
          role: 'user',
          content: `ชีตชื่อ "${sheetName}" จำนวนแถวทั้งหมด ${grid.length}\n\n${table}`,
        },
      ],
    })

    if (response.stop_reason === 'refusal') return { status: 'failed', reason: 'Claude ปฏิเสธการอ่านชีตนี้' }
    if (response.stop_reason === 'max_tokens') return { status: 'failed', reason: 'คำตอบยาวเกินกำหนด' }
    const parsed = response.parsed_output
    if (!parsed) return { status: 'failed', reason: 'อ่านคำตอบไม่ได้' }

    const headerRows: 1 | 2 = parsed.header_row_count === 2 ? 2 : 1
    const headerRow = Math.max(1, parsed.header_row)
    const dataStart = Math.max(headerRow + headerRows, parsed.data_start_row)

    return {
      status: 'ok',
      result: {
        mapping: {
          item_no: parsed.columns.item_no ?? null,
          description: parsed.columns.description ?? null,
          unit: parsed.columns.unit ?? null,
          qty: parsed.columns.qty ?? null,
          material_price: parsed.columns.material_price ?? null,
          labor_price: parsed.columns.labor_price ?? null,
          total: parsed.columns.total ?? null,
          markup_pct: parsed.columns.markup_pct ?? null,
          material_total: parsed.columns.material_total ?? null,
          labor_total: parsed.columns.labor_total ?? null,
          unit_rate: parsed.columns.unit_rate ?? null,
          material_cost: parsed.columns.material_cost ?? null,
          labor_cost: parsed.columns.labor_cost ?? null,
          material_cost_total: parsed.columns.material_cost_total ?? null,
          labor_cost_total: parsed.columns.labor_cost_total ?? null,
        },
        layout: { header_row: headerRow, header_rows: headerRows, data_start_row: dataStart },
        is_boq_detail_sheet: parsed.is_boq_detail_sheet,
        sheet_kind: parsed.sheet_kind,
        confidence: parsed.confidence,
        warnings: parsed.warnings.slice(0, 4),
        roles: new Map(parsed.summary_rows.map(r => [r.row, r.kind])),
        contract_cell: parsed.contract_value_cell,
      },
    }
  } catch (e) {
    console.error(`วิเคราะห์ชีต ${sheetName} ไม่สำเร็จ ใช้การตรวจจับแบบกฎแทน:`, e)
    if (e instanceof Anthropic.AuthenticationError) return { status: 'failed', reason: 'API key ไม่ถูกต้อง' }
    if (e instanceof Anthropic.PermissionDeniedError) return { status: 'failed', reason: 'API key ไม่มีสิทธิ์ใช้งานโมเดลนี้' }
    if (e instanceof Anthropic.RateLimitError) return { status: 'failed', reason: 'เรียกใช้บ่อยเกินไปหรือเครดิตหมด' }
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { status: 'failed', reason: 'Claude ตอบช้าเกินกำหนด' }
    if (e instanceof Anthropic.APIConnectionError) return { status: 'failed', reason: 'เชื่อมต่อ API ไม่ได้' }
    if (e instanceof Anthropic.APIError) {
      let hint = ''
      if (/workspace/i.test(e.message)) {
        const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
        hint = ws
          ? ` · เซิร์ฟเวอร์ส่ง workspace ${ws.slice(0, 14)} ไปแล้ว ตรวจว่า ID ถูกต้องและอยู่องค์กรเดียวกับ key`
          : ' · เซิร์ฟเวอร์ยังไม่เห็นตัวแปร ANTHROPIC_WORKSPACE_ID ตรวจชื่อตัวแปร ติ๊ก Production แล้ว Redeploy'
      }
      return { status: 'failed', reason: `API ตอบกลับ ${e.message}`.slice(0, 400) + hint }
    }
    // เช่นคำตอบไม่ตรงรูปแบบที่กำหนด ให้ผู้ใช้เห็นข้อความจริงไว้ส่งต่อให้ผู้ดูแลระบบ
    return { status: 'failed', reason: `อ่านคำตอบของ Claude ไม่ได้: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) }
  }
}
