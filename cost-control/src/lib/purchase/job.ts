// หาโครงการจากเลขงาน (JOB) ในเอกสารจัดซื้อ เช่น "A6910-05(V100) / 6492"
// เทียบด้วยโค้ดจากรหัสงานและเลขเวอร์ชันที่เขียนอยู่ในรหัสหรือชื่อโครงการ ไม่ยึดตำแหน่งหรือรูปแบบตายตัวของชื่อโครงการ
export interface JobProject {
  id: string
  code: string
  name: string
}

const norm = (t: string) => t.toUpperCase().replace(/\s+/g, '')

function tokens(jobRef: string) {
  const t = norm(jobRef)
  return {
    jobs: [...new Set(t.match(/[A-Z]{1,3}\d{3,6}-\d{1,4}/g) ?? [])],
    versions: [...new Set(t.match(/V\d{2,4}/g) ?? [])],
  }
}

// คืน id โครงการเมื่อเจอโครงการเดียวที่ตรง ถ้าไม่เจอหรือกำกวมคืน null
export function matchProjectByJob(jobRef: string | null, projects: JobProject[]): string | null {
  if (!jobRef) return null
  const { jobs, versions } = tokens(jobRef)
  if (jobs.length === 0) return null
  const hay = (p: JobProject) => norm(`${p.code} ${p.name}`)
  // รหัสงานต้องตรงทั้งก้อน A6910-05 ต้องไม่ไปตรงกับ A6910-051
  const hasJob = (h: string, j: string) => new RegExp(`(^|[^A-Z0-9])${j}($|[^0-9])`).test(h)
  let found = projects.filter(p => jobs.some(j => hasJob(hay(p), j)))
  if (found.length > 1 && versions.length) {
    const narrowed = found.filter(p => versions.some(v => hay(p).includes(v)))
    if (narrowed.length) found = narrowed
  }
  return found.length === 1 ? found[0].id : null
}
