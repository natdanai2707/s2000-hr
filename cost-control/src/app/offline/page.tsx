export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
        <p className="text-sm text-muted-foreground mt-2">
          หน้านี้ยังไม่ได้ถูกเก็บไว้ในเครื่อง ฟอร์มใบขอซื้อที่ส่งขณะออฟไลน์จะถูกเก็บไว้และส่งอัตโนมัติเมื่อกลับมาออนไลน์
        </p>
      </div>
    </div>
  )
}
