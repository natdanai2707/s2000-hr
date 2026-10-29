import { requireUser } from '@/lib/auth'
import { PageHeader } from '@/components/app/common'
import { ChangePasswordForm } from '@/components/app/change-password-form'
import { ROLE_LABELS } from '@/lib/types'

export default async function AccountPage() {
  const user = await requireUser()
  return (
    <div className="max-w-md">
      <PageHeader title="เปลี่ยนรหัสผ่าน" subtitle={`${user.profile.full_name} · ${user.email ?? ''} · ${ROLE_LABELS[user.profile.role]}`} />
      <ChangePasswordForm />
    </div>
  )
}
