import type { ColorManagementSettings } from "../types"

export const DEFAULT_COLOR_MANAGEMENT: ColorManagementSettings = {
  assignedProfile: "sRGB IEC61966-2.1",
  workingSpace: "sRGB IEC61966-2.1",
  renderingIntent: "relative-colorimetric",
  blackPointCompensation: true,
  proofProfile: "None",
  proofColors: false,
  gamutWarning: false,
  proofChannels: [],
  proofPlateView: "composite",
}
