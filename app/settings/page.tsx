import type { Metadata } from "next"
import { SettingsEntry } from "@/app/settings/settings-entry"

export const metadata: Metadata = {
  title: "Photoshop Web — Settings",
  description:
    "Editor settings: interface layout, appearance, performance, scratch storage, file handling, tools, and units.",
}

export default function Page() {
  return <SettingsEntry />
}
