import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ColumnMapping } from './split'
import type { SheetLayout } from './layout'

// ให้ Claude อ่านตารางแล้วบอกว่าคอลัมน์ไหนคืออะไร แทนการจับคู่ชื่อคอลัมน์ด้วยกฎตายตัว
// เหตุผล: BOQ จริงมาจากผู้ประมาณราคาหลายคน หัวคอลัมน์สะกดไม่เหมือนกัน พิมพ์ผิด
// สลับภาษาไทยอังกฤษ หรือใช้คำที่ไม่เคยเจอ กฎตายตัวพลาดแล้วนำเข้าไม่ได้ทั้งไฟล์
//
// สำคัญ: Claude ตัดสินแค่ว่าคอลัมน์ไหนคืออะไร ไม่เคยแตะตัวเลข
// การคำนวณทั้งหมดยังทำด้วยโค้ดใน splitRows เหมือนเดิม ไฟล์เดิมจึงให้ผลเดิมทุกครั้ง
// และผู้ใช้ยังตรวจการจับคู่คอลัมน์ได้ก่อนกดนำเข้าจริง

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
    markup_pct: ColumnIndex.describe(
      'คอลัมน์เปอร์เซ็นต์กำไรหรือ markup เท่านั้น ถ้าเป็นคอลัมน์ราคาที่บังเอิญมีเครื่องหมายเปอร์เซ็นต์ในชื่อ ให้เป็น null'
    ),
  }),
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
}

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
7. คอลัมน์ไหนไม่มีในชีต ให้ตอบ null อย่าเดา`

function gridToText(grid: unknown[][], maxRows: number, maxCols: number): string {
  const lines: string[] = []
  const header = Array.from({ length: maxCols }, (_, c) => `c${c}`).join(' | ')
  lines.push(`แถว | ${header}`)
  for (let r = 0; r < Math.min(grid.length, maxRows); r++) {
    const cells: string[] = []
    for (let c = 0; c < maxCols; c++) {
      const v = grid[r]?.[c]
      const text = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').slice(0, 60)
      cells.push(text)
    }
    if (cells.every(x => x === '')) continue
    lines.push(`r${r + 1} | ${cells.join(' | ')}`)
  }
  return lines.join('\n')
}

export function analysisEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// วิเคราะห์หนึ่งชีต คืน null ถ้าไม่ได้ตั้งค่า API key หรือเรียกไม่สำเร็จ
// ผู้เรียกต้องมีทางสำรองแบบกฎตายตัวเสมอ ระบบต้องนำเข้าได้แม้ไม่มี API
export async function analyzeSheet(sheetName: string, grid: unknown[][]): Promise<AnalyzeResult | null> {
  if (!analysisEnabled()) return null
  const maxCols = Math.min(Math.max(...grid.slice(0, 60).map(r => r.length), 1), 16)
  const table = gridToText(grid, 45, maxCols)

  try {
    const client = new Anthropic()
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(AnalysisSchema),
      },
      messages: [
        {
          role: 'user',
          content: `ชีตชื่อ "${sheetName}" จำนวนแถวทั้งหมด ${grid.length}\n\n${table}`,
        },
      ],
    })

    const parsed = response.parsed_output
    if (!parsed) return null

    const headerRows: 1 | 2 = parsed.header_row_count === 2 ? 2 : 1
    const headerRow = Math.max(1, parsed.header_row)
    const dataStart = Math.max(headerRow + headerRows, parsed.data_start_row)

    return {
      mapping: {
        item_no: parsed.columns.item_no ?? null,
        description: parsed.columns.description ?? null,
        unit: parsed.columns.unit ?? null,
        qty: parsed.columns.qty ?? null,
        material_price: parsed.columns.material_price ?? null,
        labor_price: parsed.columns.labor_price ?? null,
        total: parsed.columns.total ?? null,
        markup_pct: parsed.columns.markup_pct ?? null,
      },
      layout: { header_row: headerRow, header_rows: headerRows, data_start_row: dataStart },
      is_boq_detail_sheet: parsed.is_boq_detail_sheet,
      sheet_kind: parsed.sheet_kind,
      confidence: parsed.confidence,
      warnings: parsed.warnings.slice(0, 4),
    }
  } catch (e) {
    console.error(`วิเคราะห์ชีต ${sheetName} ไม่สำเร็จ ใช้การตรวจจับแบบกฎแทน:`, e)
    return null
  }
}
