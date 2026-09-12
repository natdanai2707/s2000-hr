import 'server-only'

// LINE Messaging API push message ถ้าไม่มี credentials ให้ log แทนและทำงานต่อ
export async function sendLine(to: string, text: string): Promise<void> {
  const token = process.env.LINE_MESSAGING_TOKEN
  if (!token) {
    console.info(`[LINE ยังไม่ตั้งค่า] ถึง ${to}: ${text}`)
    return
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) console.error('LINE push failed:', res.status, await res.text())
  } catch (e) {
    console.error('LINE push error:', e)
  }
}
