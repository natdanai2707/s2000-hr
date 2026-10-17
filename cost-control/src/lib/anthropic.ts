import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

// ตั้งค่าการเรียก Claude ที่ใช้ร่วมกัน (อ่านไฟล์ BOQ และอ่านรูปใบสั่งซื้อ)
export const CLAUDE_MODEL = 'claude-opus-5-5'

export function analysisEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// key ระดับองค์กรที่ไม่ได้ผูกกับ workspace ต้องบอก workspace ในทุกคำขอ
export function anthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  return new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {})
}

// แปลง error จาก API เป็นสาเหตุภาษาไทยที่ผู้ใช้อ่านแล้วแก้ต่อได้
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API key ไม่ถูกต้อง'
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key ไม่มีสิทธิ์ใช้งานโมเดลนี้'
  if (e instanceof Anthropic.RateLimitError) return 'เรียกใช้บ่อยเกินไปหรือเครดิตหมด'
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'Claude ตอบช้าเกินกำหนด'
  if (e instanceof Anthropic.APIConnectionError) return 'เชื่อมต่อ API ไม่ได้'
  if (e instanceof Anthropic.APIError) {
    let hint = ''
    if (/workspace/i.test(e.message)) {
      const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
      hint = ws
        ? ` · เซิร์ฟเวอร์ส่ง workspace ${ws.slice(0, 14)} ไปแล้ว ตรวจว่า ID ถูกต้องและอยู่องค์กรเดียวกับ key`
        : ' · เซิร์ฟเวอร์ยังไม่เห็นตัวแปร ANTHROPIC_WORKSPACE_ID ตรวจชื่อตัวแปร ติ๊ก Production แล้ว Redeploy'
    }
    return `API ตอบกลับ ${e.message}`.slice(0, 400) + hint
  }
  // เช่นคำตอบไม่ตรงรูปแบบที่กำหนด ให้ผู้ใช้เห็นข้อความจริงไว้ส่งต่อให้ผู้ดูแลระบบ
  return `อ่านคำตอบของ Claude ไม่ได้: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)
}
