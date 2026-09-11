import { createClient } from '@/lib/supabase/server'

// ลิงก์ไฟล์แนบใน bucket private ผ่าน signed URL (อายุ 1 ชั่วโมง) RLS ของ storage ตรวจสิทธิ์โครงการ
export async function AttachmentLink({ path, label = 'เปิดไฟล์แนบ' }: { path: string | null; label?: string }) {
  if (!path) return null
  const supabase = await createClient()
  const { data } = await supabase.storage.from('project-files').createSignedUrl(path, 3600)
  if (!data?.signedUrl) return <span className="text-xs text-muted-foreground">ไฟล์แนบเปิดไม่ได้</span>
  return (
    <a href={data.signedUrl} target="_blank" rel="noreferrer" className="text-xs underline">
      {label}
    </a>
  )
}
