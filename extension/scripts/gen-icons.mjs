// Generates the three icon PNGs required by the Chrome extension manifest.
// Produces a minimal valid PNG with a target/bullseye (Cazador brand mark)
// drawn in brand gradient colors on a transparent rounded-square background.
// No external deps — pure Node.
//
// Brand identity (Cazador = "hunter" in Spanish): concentric target rings
// with a center dot, evoking aim/precision. The brand gradient remains the
// same green→cyan→yellow→orange sweep used across the rest of the UI.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const SIZES = [16, 48, 128]

// Brand gradient stops (green → cyan → yellow → orange)
const STOPS = [
  { t: 0, r: 46, g: 229, b: 157 },
  { t: 0.33, r: 34, g: 184, b: 255 },
  { t: 0.66, r: 255, g: 217, b: 61 },
  { t: 1, r: 255, g: 159, b: 67 },
]

function mix(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function gradientColor(t) {
  if (t <= 0) return STOPS[0]
  if (t >= 1) return STOPS[STOPS.length - 1]
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t)
      return {
        r: mix(a.r, b.r, localT),
        g: mix(a.g, b.g, localT),
        b: mix(a.b, b.b, localT),
      }
    }
  }
  return STOPS[0]
}

/**
 * Render a Cazador brand icon: gradient-filled rounded square with a white
 * target/bullseye (3 concentric rings + center dot) drawn on top.
 *
 * The visible shape matches the sidebar header: the `.cz-logo-mark` div
 * has a brand-gradient background and a white Target lucide icon inside.
 * Here we mirror that on a transparent PNG so the toolbar icon reads as
 * the same brand mark.
 *
 * Bullseye geometry (in fractions of the outer ring radius `maxR`):
 *   - Outer ring : inner 0.78 · maxR, outer 1.00 · maxR
 *   - Middle ring: inner 0.45 · maxR, outer 0.60 · maxR
 *   - Center dot : radius 0.18 · maxR (filled)
 */
function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4)
  // Rounded square background inset.
  const pad = Math.max(0.5, size * 0.04)
  const radius = size * 0.22
  // Target rings scaled to the icon size.
  const maxR = size * 0.34
  const cx = size / 2 - 0.5
  const cy = size / 2 - 0.5

  const rings = [
    [maxR * 0.78, maxR], // outer ring
    [maxR * 0.45, maxR * 0.6], // middle ring
  ]
  const centerR = maxR * 0.18

  const corners = [
    { cx: pad + radius, cy: pad + radius },
    { cx: size - pad - radius, cy: pad + radius },
    { cx: pad + radius, cy: size - pad - radius },
    { cx: size - pad - radius, cy: size - pad - radius },
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4

      // Outside the rounded square → transparent.
      const inX = x >= pad && x < size - pad
      const inY = y >= pad && y < size - pad
      if (!inX || !inY) {
        buf[idx + 3] = 0
        continue
      }

      // Cut rounded corners by checking each corner disk.
      let masked = false
      for (const c of corners) {
        const dx = Math.abs(x - c.cx)
        const dy = Math.abs(y - c.cy)
        if (
          x < c.cx + 0.5 &&
          y < c.cy + 0.5 &&
          dx * dx + dy * dy > radius * radius
        ) {
          masked = true
          break
        }
      }
      if (masked) {
        buf[idx + 3] = 0
        continue
      }

      // Distance from icon center → determines ring membership.
      const ddx = x - cx
      const ddy = y - cy
      const d = Math.sqrt(ddx * ddx + ddy * ddy)

      let inTarget = false
      for (const [rIn, rOut] of rings) {
        if (d >= rIn && d <= rOut) {
          inTarget = true
          break
        }
      }
      if (d <= centerR) inTarget = true

      if (inTarget) {
        // White target on top of the gradient.
        buf[idx] = 255
        buf[idx + 1] = 255
        buf[idx + 2] = 255
        buf[idx + 3] = 255
      } else {
        // Brand gradient background (diagonal sweep).
        const t = (x + y) / (2 * Math.max(1, size - 1))
        const c = gradientColor(Math.min(1, Math.max(0, t)))
        buf[idx] = c.r
        buf[idx + 1] = c.g
        buf[idx + 2] = c.b
        buf[idx + 3] = 255
      }
    }
  }
  return buf
}

function crc32Table() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
}
const CRC_TABLE = crc32Table()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const rgba = renderIcon(size)
  const png = encodePng(rgba, size)
  const outPath = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(outPath, png)
  console.log(`wrote ${outPath} (${png.length} bytes)`)
}
