/** Loading / error / empty placeholders used across pages. */

import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-hidden />
}

export function LoadingBlock({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground', className)}>
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorBlock({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyBlock({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-dashed border-border px-4 py-8 text-center', className)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}
