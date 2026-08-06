'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'pointer-events-none data-[state=open]:pointer-events-auto data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  showOverlay = true,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  showOverlay?: boolean
}) {
  // Radix-Dialog warns whenever DialogContent is rendered without an
  // associated DialogDescription. If the caller already provided one
  // (somewhere in the children tree), or explicitly passed
  // `aria-describedby` to opt out, do nothing. Otherwise, inject an
  // invisible DialogDescription so Radix's internal context registration
  // wires up `aria-describedby` automatically and screen readers get a
  // meaningful (if generic) description. The visible UI is unchanged.
  const callerProvidedDescribedBy = ariaDescribedBy !== undefined
  const hasDescription = !callerProvidedDescribedBy && hasDialogDescription(children)
  const passthroughProps = callerProvidedDescribedBy
    ? { "aria-describedby": ariaDescribedBy, ...props }
    : props

  return (
    <DialogPortal data-slot="dialog-portal">
      {showOverlay ? <DialogOverlay /> : null}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // `max-w-lg` is deliberately unprefixed. A `sm:max-w-lg` here survives
          // tailwind-merge alongside a caller's `max-w-[820px]` (different variant
          // scope) and then wins on cascade order, silently clamping every wide
          // dialog to 512px. The viewport clamp lives on `w-`, which no caller
          // sets, so it can never be merged away either.
          'pointer-events-none bg-[var(--ps-panel)] text-[var(--ps-text)] data-[state=open]:pointer-events-auto data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-auto overscroll-contain rounded-lg border border-[var(--ps-divider)] p-6 shadow-lg duration-200 [&>*]:min-w-0',
          className,
        )}
        {...passthroughProps}
      >
        {!callerProvidedDescribedBy && !hasDescription ? (
          <DialogPrimitive.Description data-slot="dialog-description" className="sr-only">
            Dialog
          </DialogPrimitive.Description>
        ) : null}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function hasDialogDescription(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false
    if (child.type === DialogDescription) return true
    const props = child.props as { children?: React.ReactNode }
    return hasDialogDescription(props.children)
  })
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
