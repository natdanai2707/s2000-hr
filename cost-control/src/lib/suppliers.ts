export interface SupplierOption {
  id: string
  name: string
}

// เทียบชื่อแบบไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างซ้ำ ให้ตรงกับ normalize_supplier_name ในฐานข้อมูล
export function normalizeSupplierName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function filterSuppliers(suppliers: SupplierOption[], query: string, limit = 8): SupplierOption[] {
  const q = normalizeSupplierName(query)
  if (!q) return suppliers.slice(0, limit)
  const starts: SupplierOption[] = []
  const contains: SupplierOption[] = []
  for (const s of suppliers) {
    const n = normalizeSupplierName(s.name)
    if (n.startsWith(q)) starts.push(s)
    else if (n.includes(q)) contains.push(s)
  }
  return [...starts, ...contains].slice(0, limit)
}
