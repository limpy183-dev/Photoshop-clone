"use client"

import * as React from "react"
import { addPhotoshopEventListener } from "@/editor/events"
import { loadPreferencesFromStorage } from "@/editor/preferences-engine"
import {
  DEFAULT_INTERFACE_PREFERENCES,
  applyInterfaceCssVariables,
  normalizeInterfacePreferences,
  type InterfacePreferences,
} from "@/editor/ui-layout"

/**
 * Interface layout preferences, kept in sync with storage and published to the
 * document root as CSS variables.
 *
 * Starts from the defaults so SSR and the first client render agree, then reads
 * storage in an effect — the same hydration gating the persisted dock width uses.
 * The `storage` listener is what makes the settings page (opened in its own tab)
 * repaint an already-open editor.
 */
export function useInterfacePreferences(): InterfacePreferences {
  const [prefs, setPrefs] = React.useState<InterfacePreferences>(DEFAULT_INTERFACE_PREFERENCES)

  React.useEffect(() => {
    const read = () => {
      const next = normalizeInterfacePreferences(loadPreferencesFromStorage().interface)
      setPrefs(next)
      applyInterfaceCssVariables(next)
    }
    read()
    const removePreferences = addPhotoshopEventListener("ps-preferences-changed", read)
    window.addEventListener("storage", read)
    return () => {
      removePreferences()
      window.removeEventListener("storage", read)
    }
  }, [])

  return prefs
}
