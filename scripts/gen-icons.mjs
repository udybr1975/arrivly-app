// Regenerates every raster app icon from the Bemgu "Marker" mark.
//
//   node scripts/gen-icons.mjs
//
// WHY THIS FILE EXISTS: the mark in src/components/shared/Logo.tsx cuts the
// letter "B" out of the pin with an SVG <mask> whose <text> is set in Fraunces.
// Rasterisers (sharp/libvips, resvg, librsvg) do not load webfonts, and Fraunces
// is not installed on any dev machine here — it arrives from the Google Fonts
// CDN at runtime. So the B below is the REAL Fraunces glyph OUTLINE, extracted
// once from the static Fraunces wght=600 instance that Google serves, and frozen
// as a path, leaving this script with no font dependency at all.
//
// KNOWN DISCREPANCY, measured not assumed: index.html requests Fraunces at
// wght 300;400;500 — 600 is NOT among them — so the browser renders the mask's
// fontWeight="600" from the 500 instance (or synthesises bold), while this
// outline is the true 600. The icons are therefore very slightly heavier than
// the on-screen mark. Pre-existing (the legacy "A" carried the same
// fontWeight="600"), tiny at 26/64 units, and closed by adding 600 to the
// Fraunces URL in index.html — not by re-cutting this path.
//
// Every geometric constant below was MEASURED from the icons this replaces, so
// the new set frames the mark exactly as the old set did. See ICON_SPECS.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const BRASS = '#c8a24e'
const CHARCOAL = '#1c1c1a'

// The pin path from Logo.tsx, in its native 64x64 viewBox. Its ink spans
// y 7..57 (50 units tall) and x 13..51 — used below to size and centre it.
const PIN = 'M32 7 C21 7 13 15 13 26 C13 38 32 57 32 57 C32 57 51 38 51 26 C51 15 43 7 32 7 Z'
const PIN_INK_H = 50
const PIN_CX = 32
const PIN_CY = 32

// Fraunces 600 "B", as an outline. Font units (upem 2000, advance 1418); the
// transform reproduces Logo.tsx's <text x="32" y="34" font-size="26"
// text-anchor="middle"> exactly: scale = 26/2000, x0 = 32 - (1418*scale)/2.
const B_PATH = 'M1371 337Q1371 188 1242.5 94.0Q1114 0 857 0H164Q133 0 118.5 12.5Q104 25 104 46Q104 84 146 97L203 110Q228 117 240.5 131.0Q253 145 253 167V1233Q253 1255 240.5 1269.0Q228 1283 203 1290L146 1303Q104 1316 104 1354Q104 1376 118.5 1388.0Q133 1400 164 1400H704Q890 1400 1021.5 1349.0Q1153 1298 1222.0 1207.5Q1291 1117 1291 996Q1291 895 1234.5 816.0Q1178 737 1067.0 691.5Q956 646 793 646L849 677Q1008 677 1125.0 633.5Q1242 590 1306.5 513.5Q1371 437 1371 337ZM743 609H476V690H718Q807 690 869.0 723.5Q931 757 963.0 822.0Q995 887 995 980Q995 1079 955.5 1152.5Q916 1226 840.0 1267.0Q764 1308 654 1308H563V189Q563 140 593.5 116.0Q624 92 683 92H789Q878 92 938.5 123.0Q999 154 1030.0 211.5Q1061 269 1061 345Q1061 465 979.5 537.0Q898 609 743 609Z'
const B_SCALE = 0.013
const B_X0 = 22.783

// MEASURED from the previous icon set (pin height as a share of the canvas,
// and the rounded-square corner radius where one is present).
// pinH = pin ink height / canvas. pinCY = centre of that ink / canvas: the
// previous icons sat a few percent BELOW dead centre, which is the correct
// optical placement for a pin (its visual mass is the round head at the top).
// Both were measured off the old files so this change stays strictly "A -> B".
const ICON_SPECS = [
  { file: 'public/favicon-32.png',              size: 32,  pinH: 0.6250, pinCY: 0.5310, rounded: true,  alpha: true  },
  { file: 'public/icons/icon-192.png',          size: 192, pinH: 0.6510, pinCY: 0.5495, rounded: true,  alpha: true  },
  { file: 'public/icons/icon-512.png',          size: 512, pinH: 0.6543, pinCY: 0.5518, rounded: true,  alpha: true  },
  { file: 'public/apple-touch-icon.png',        size: 180, pinH: 0.5556, pinCY: 0.5444, rounded: false, alpha: false },
  { file: 'public/icons/icon-512-maskable.png', size: 512, pinH: 0.4668, pinCY: 0.5361, rounded: false, alpha: false },
]
const CORNER_RADIUS = 0.217 // calibrated so the rendered corner matches the old icon-512

function svg({ size, pinH, pinCY, rounded }) {
  const k = (pinH * size) / PIN_INK_H          // 64-unit space -> px
  const tx = size / 2 - PIN_CX * k
  const ty = pinCY * size - PIN_CY * k
  const bg = rounded
    ? `<rect width="${size}" height="${size}" rx="${(CORNER_RADIUS * size).toFixed(2)}" fill="${CHARCOAL}"/>`
    : `<rect width="${size}" height="${size}" fill="${CHARCOAL}"/>`
  // The mask MUST be authored in the same user space as the element it masks —
  // the pin path lives inside the transformed <g>, so the mask is written in
  // 64-unit coordinates too. Authoring it in canvas pixels double-applies the
  // transform and the B lands off-canvas, leaving a solid pin with no letter.
  // That failure is invisible to any size/mode/colour check; only looking at
  // the rendered PNG catches it.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>
      <g transform="translate(${B_X0} 34) scale(${B_SCALE} -${B_SCALE})">
        <path d="${B_PATH}" fill="#000"/>
      </g>
    </mask>
  </defs>
  ${bg}
  <g transform="translate(${tx} ${ty}) scale(${k})">
    <path d="${PIN}" fill="${BRASS}" mask="url(#cut)"/>
  </g>
</svg>`
}

for (const spec of ICON_SPECS) {
  await mkdir(dirname(spec.file), { recursive: true })
  // Rasterise well above the target and downsample: libvips picks its SVG
  // render size from `density`, not from the width/height attributes, so the
  // explicit resize is what pins the output to the exact icon dimensions.
  let img = sharp(Buffer.from(svg(spec)), { density: 384 }).resize(spec.size, spec.size)
  // The rounded variants keep transparent corners (RGBA); the two full-bleed
  // icons are flattened onto charcoal so they ship as RGB, as before.
  if (!spec.alpha) img = img.flatten({ background: CHARCOAL })
  const out = await img.png({ compressionLevel: 9 }).toBuffer()
  await writeFile(spec.file, out)
  console.log(`wrote ${spec.file} (${spec.size}x${spec.size}, ${out.length} bytes)`)
}
