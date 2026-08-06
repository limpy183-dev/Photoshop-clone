"use client"

import dynamic from "next/dynamic"
import { useInterfacePreferences } from "@/editor/use-interface-preferences"

// Same treatment as the editor entry: the preferences surface reads
// localStorage on mount, so there is nothing useful to server-render.
const PreferencesPage = dynamic(
  () => import("@/components/photoshop/preferences-dialog").then((m) => m.PreferencesPage),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-[12px] text-[var(--ps-text-dim)]">Loading settings</div>
    ),
  },
)

export function SettingsEntry() {
  // Renders this page in the user's own theme, and repaints it the moment
  // interface preferences are saved.
  useInterfacePreferences()
  return (
    <div className="min-h-screen bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <PreferencesPage />
    </div>
  )
}
