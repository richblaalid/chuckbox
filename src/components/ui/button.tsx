import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.97] motion-reduce:transform-none",
  {
    variants: {
      variant: {
        // Primary - Forest green with branded shadow on hover
        default:
          "bg-forest-700 text-white shadow-sm hover:bg-forest-800 hover:shadow-forest hover:-translate-y-0.5 active:translate-y-0",
        // Destructive - Error red
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-red-700 hover:-translate-y-0.5 active:translate-y-0",
        // Outline - Forest green border
        outline:
          "border-2 border-forest-700 bg-transparent text-forest-700 hover:bg-forest-700 hover:text-white hover:-translate-y-0.5 active:translate-y-0",
        // Secondary - Outline style (Brand Guide January 2026)
        secondary:
          "border border-stone-300 bg-transparent text-stone-700 hover:border-stone-400 hover:bg-stone-50 hover:-translate-y-0.5 active:translate-y-0",
        // Ghost - Subtle hover
        ghost:
          "text-forest-700 hover:bg-stone-100 hover:text-forest-800",
        // Link - Underline style
        link:
          "text-forest-700 underline-offset-4 hover:underline",
        // Success - Green action
        success:
          "bg-success text-white shadow-sm hover:bg-success-dark hover:-translate-y-0.5 active:translate-y-0",
        // Warning - Amber action
        warning:
          "bg-warning text-white shadow-sm hover:bg-warning-dark hover:-translate-y-0.5 active:translate-y-0",
        // Accent - Amber for high-visibility CTAs (Brand Guide: btn-primary)
        accent:
          "bg-amber-700 text-white shadow-sm hover:bg-amber-800 hover:shadow-amber hover:-translate-y-0.5 active:translate-y-0",
      },
      size: {
        default: "h-11 px-5 py-2.5",  // 44px min touch target
        sm: "h-9 rounded-md px-4 text-xs",  // 36px - acceptable for secondary actions
        lg: "h-12 rounded-md px-8 text-base",
        icon: "h-11 w-11",  // 44px touch target
        // Inline size for text-level links without height/padding constraints
        inline: "h-auto p-0 text-sm font-normal",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const isDisabled = disabled || loading

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <>
            <Spinner size={size === 'sm' ? 'sm' : 'default'} />
            <span>{loadingText || children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
