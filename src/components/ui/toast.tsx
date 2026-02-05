'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

const toastVariants = cva(
  'pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-4 shadow-lg',
  {
    variants: {
      variant: {
        default: 'border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100',
        success: 'border-success/30 bg-success-light text-success-dark dark:bg-success/20 dark:text-success',
        error: 'border-error/30 bg-error-light text-error-dark dark:bg-error/20 dark:text-error',
        warning: 'border-warning/30 bg-warning-light text-warning-dark dark:bg-warning/20 dark:text-warning',
        info: 'border-info/30 bg-info-light text-info-dark dark:bg-info/20 dark:text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

const iconMap = {
  default: null,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastProps extends Toast {
  onDismiss: (id: string) => void
}

function ToastItem({
  id,
  title,
  description,
  variant = 'default',
  action,
  onDismiss,
}: ToastProps) {
  const Icon = iconMap[variant]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 100, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(toastVariants({ variant }))}
    >
      {Icon && <Icon className="h-5 w-5 shrink-0" />}
      <div className="flex-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {description && (
          <p className="text-sm opacity-90">{description}</p>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="shrink-0 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  )
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  dismissToast: (id: string) => void
  dismissAll: () => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

/**
 * ToastProvider - Manages toast state and renders the toast container
 * Wrap your app with this provider to enable toast notifications
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast: Toast = { ...toast, id }

    setToasts((prev) => [...prev, newToast])

    // Auto-dismiss after duration (default 5 seconds)
    const duration = toast.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dismissAll = React.useCallback(() => {
    setToasts([])
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast, dismissAll }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

/**
 * ToastContainer - Renders toasts in the top-right corner
 */
function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="pointer-events-none fixed right-0 top-0 z-50 flex max-h-screen w-full flex-col gap-2 p-4 sm:max-w-[420px]">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} {...toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * Convenience functions for creating toasts
 * Note: These are stub functions - actual toast implementation uses ToastContext
 */
export const toast = {
  success: (_title: string, _description?: string) => {
    // Stub - use ToastContext.showToast() instead
  },
  error: (_title: string, _description?: string) => {
    // Stub - use ToastContext.showToast() instead
  },
  warning: (_title: string, _description?: string) => {
    // Stub - use ToastContext.showToast() instead
  },
  info: (_title: string, _description?: string) => {
    // Stub - use ToastContext.showToast() instead
  },
}
