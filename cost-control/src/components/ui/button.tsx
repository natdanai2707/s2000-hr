import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // ปุ่มทุกแบบมีพื้นหรือกรอบ ให้ดูกดได้ชัด สูง 48px (sm 40px) ตามแนว Clear
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-input',
        outline: 'border border-input bg-background text-foreground hover:bg-muted hover:border-foreground/60',
        ghost: 'border border-border bg-background text-foreground hover:bg-muted hover:border-input',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        // ปุ่มเปิดหน้าต่างลบหรือยกเลิก ไม่ให้เด่นเท่าปุ่มหลัก ปุ่มยืนยันในหน้าต่างใช้ destructive
        'danger-outline': 'border border-destructive/60 bg-background text-destructive hover:bg-danger-bg',
        success: 'bg-success text-white hover:bg-success/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-5 py-2',
        sm: 'h-10 px-3 text-sm',
        lg: 'h-14 px-6 text-base',
        icon: 'h-12 w-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
