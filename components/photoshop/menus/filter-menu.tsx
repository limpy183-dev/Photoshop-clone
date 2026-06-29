"use client"

import {
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarMenu as DropdownMenu,
  MenubarSeparator as DropdownMenuSeparator,
  MenubarShortcut as DropdownMenuShortcut,
  MenubarSub as DropdownMenuSub,
  MenubarSubContent as DropdownMenuSubContent,
  MenubarSubTrigger as DropdownMenuSubTrigger,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import { getFilterName } from "../filters-meta"
import type { Layer } from "../types"

interface FilterMenuProps {
  menuClass: string
  activeLayer: Layer | null
  lastFilter: string | null
  applyInstant: (filterId: string) => void | Promise<void>
  openFilterDialog: (filterId: string) => void
  setCameraRawOpen: (open: boolean) => void
  setFilterGalleryOpen: (open: boolean) => void
  setLiquifyOpen: (open: boolean) => void
  setPuppetWarpOpen: (open: boolean) => void
}

const ARTISTIC_FILTERS = [
  "colored-pencil",
  "cutout",
  "dry-brush",
  "film-grain",
  "fresco",
  "neon-glow",
  "paint-daubs",
  "palette-knife",
  "plastic-wrap",
  "poster-edges",
  "rough-pastels",
  "smudge-stick",
  "sponge-filter",
  "underpainting",
  "watercolor",
]

const BRUSH_STROKE_FILTERS = [
  "accented-edges",
  "angled-strokes",
  "crosshatch",
  "dark-strokes",
  "ink-outlines",
  "spatter",
  "sprayed-strokes",
  "sumi-e",
]

const SKETCH_FILTERS = [
  "bas-relief",
  "chalk-charcoal",
  "charcoal",
  "chrome",
  "conte-crayon",
  "graphic-pen",
  "halftone-pattern",
  "note-paper",
  "photocopy",
  "plaster",
  "reticulation",
  "stamp-filter",
  "torn-edges",
  "water-paper",
]

const TEXTURE_FILTERS = [
  "craquelure",
  "grain",
  "mosaic-tiles",
  "patchwork",
  "stained-glass",
  "texturizer",
]

function FilterList({
  ids,
  openFilterDialog,
}: {
  ids: readonly string[]
  openFilterDialog: (filterId: string) => void
}) {
  return (
    <>
      {ids.map((id) => (
        <DropdownMenuItem key={id} onSelect={() => openFilterDialog(id)}>
          {getFilterName(id)}
        </DropdownMenuItem>
      ))}
    </>
  )
}

export function FilterMenu({
  menuClass,
  activeLayer,
  lastFilter,
  applyInstant,
  openFilterDialog,
  setCameraRawOpen,
  setFilterGalleryOpen,
  setLiquifyOpen,
  setPuppetWarpOpen,
}: FilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={menuClass}>Filter</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onSelect={() => lastFilter && openFilterDialog(lastFilter)}>
          Last Filter
          {lastFilter ? `: ${getFilterName(lastFilter)}` : ""}
          <DropdownMenuShortcut>Cmd+F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFilterGalleryOpen(true)} disabled={!activeLayer}>
          Filter Gallery...
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCameraRawOpen(true)} disabled={!activeLayer}>
          Camera Raw Filter...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openFilterDialog("sky-replacement")} disabled={!activeLayer}>
          Sky Replacement...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLiquifyOpen(true)} disabled={!activeLayer}>
          Liquify... <DropdownMenuShortcut>Cmd+Shift+X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPuppetWarpOpen(true)} disabled={!activeLayer}>
          Puppet Warp...
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Blur</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("gaussian-blur")}>Gaussian Blur...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyInstant("average-blur")}>Average</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyInstant("blur-more")}>Blur More</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("box-blur")}>Box Blur...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("smart-blur")}>Smart Blur...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("shape-blur")}>Shape Blur...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("motion-blur")}>Motion Blur...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("lens-blur")}>Lens Blur...</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Blur Gallery</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("field-blur")}>Field Blur...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("iris-blur")}>Iris Blur...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("tilt-shift")}>Tilt-Shift...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("path-blur")}>Path Blur...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("spin-blur")}>Spin Blur...</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sharpen</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("sharpen")}>Sharpen...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("unsharp-mask")}>Unsharp Mask...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("smart-sharpen")}>Smart Sharpen...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Stylize</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => applyInstant("find-edges")}>Find Edges</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("glowing-edges")}>Glowing Edges...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("wind")}>Wind...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("extrude")}>Extrude...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("diffuse")}>Diffuse...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("tiles")}>Tiles...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("emboss")}>Emboss...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("solarize")}>Solarize...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Pixelate</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("pixelate")}>Mosaic...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("color-halftone")}>Color Halftone...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("mezzotint")}>Mezzotint...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("pointillize")}>Pointillize...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyInstant("fragment")}>Fragment</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("facet")}>Facet...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Noise</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("noise")}>Add Noise...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("reduce-noise")}>Reduce Noise...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("dust-scratches")}>Dust & Scratches...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyInstant("despeckle")}>Despeckle</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Artistic</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FilterList ids={ARTISTIC_FILTERS} openFilterDialog={openFilterDialog} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Brush Strokes</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FilterList ids={BRUSH_STROKE_FILTERS} openFilterDialog={openFilterDialog} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sketch</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FilterList ids={SKETCH_FILTERS} openFilterDialog={openFilterDialog} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Texture</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FilterList ids={TEXTURE_FILTERS} openFilterDialog={openFilterDialog} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Distort</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("adaptive-wide-angle")}>Adaptive Wide Angle...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("lens-correction")}>Lens Correction...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("vanishing-point")}>Vanishing Point...</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openFilterDialog("displace")}>Displace...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("shear")}>Shear...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("diffuse-glow")}>Diffuse Glow...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("ocean-ripple")}>Ocean Ripple...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("twirl")}>Twirl...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("pinch")}>Pinch...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("spherize")}>Spherize...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("wave")}>Wave...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("ripple")}>Ripple...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("zigzag")}>ZigZag...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("polar-coordinates")}>Polar Coordinates...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Render</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("clouds")}>Clouds...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("difference-clouds")}>Difference Clouds...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("lighting-effects")}>Lighting Effects...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("fibers")}>Fibers...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("lens-flare")}>Lens Flare...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("flame")}>Flame...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("picture-frame")}>Picture Frame...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("tree")}>Tree...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Other</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openFilterDialog("high-pass")}>High Pass...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("offset")}>Offset...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("maximum")}>Maximum...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("minimum")}>Minimum...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("custom-filter")}>Custom Filter...</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => applyInstant("grayscale")}>Grayscale</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("sepia")}>Sepia...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyInstant("invert")}>Invert</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
