"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle className="sr-only">About Photoshop Web</DialogTitle>
          <DialogDescription className="sr-only">Application information.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center text-center space-y-4 py-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#31a8ff] to-[#001e36] flex items-center justify-center shadow-lg">
            <span className="text-white text-2xl font-bold tracking-tight">Ps</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Photoshop Web</h2>
            <p className="text-[11px] text-[var(--ps-text-dim)]">Version 1.0.0</p>
          </div>
          <div className="text-[11px] text-[var(--ps-text-dim)] space-y-1 max-w-[280px]">
            <p>A browser-based image editor inspired by Adobe Photoshop, built on local canvas workflows.</p>
            <p className="pt-2">
              Built with <strong>Next.js</strong>, <strong>React</strong>, <strong>TypeScript</strong>, and the <strong>Canvas API</strong>.
            </p>
          </div>
          <div className="border-t border-[var(--ps-divider)] pt-3 text-[10px] text-[var(--ps-text-dim)] w-full space-y-0.5">
            <p>26 blend modes - 40+ local filters - Advanced brush engine</p>
            <p>Layer styles - Smart-object style raster layers - Vector tools</p>
            <p>History - Channels - Quick mask - Guide layouts</p>
            <p>Simulated proofing, local metadata, and browser-limited advanced imports</p>
          </div>
          <div className="text-[10px] text-[var(--ps-text-dim)]">
            Copyright {new Date().getFullYear()} Photoshop Web Project
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
