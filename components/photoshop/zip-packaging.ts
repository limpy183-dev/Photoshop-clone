export interface StoredZipEntry {
  name: string
  data: Uint8Array
}

function zipU16(value: number) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function zipU32(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concatZipBytes(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function dosTimestamp(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { time, date: dosDate }
}

export function encodeStoredZip(entries: readonly StoredZipEntry[]) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const stamp = dosTimestamp()
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, "/"))
    const data = entry.data
    const crc = crc32(data)
    const local = concatZipBytes([
      zipU32(0x04034b50),
      zipU16(20),
      zipU16(0),
      zipU16(0),
      zipU16(stamp.time),
      zipU16(stamp.date),
      zipU32(crc),
      zipU32(data.length),
      zipU32(data.length),
      zipU16(name.length),
      zipU16(0),
      name,
      data,
    ])
    const central = concatZipBytes([
      zipU32(0x02014b50),
      zipU16(20),
      zipU16(20),
      zipU16(0),
      zipU16(0),
      zipU16(stamp.time),
      zipU16(stamp.date),
      zipU32(crc),
      zipU32(data.length),
      zipU32(data.length),
      zipU16(name.length),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU32(0),
      zipU32(offset),
      name,
    ])
    localParts.push(local)
    centralParts.push(central)
    offset += local.length
  }

  const centralDirectory = concatZipBytes(centralParts)
  const end = concatZipBytes([
    zipU32(0x06054b50),
    zipU16(0),
    zipU16(0),
    zipU16(entries.length),
    zipU16(entries.length),
    zipU32(centralDirectory.length),
    zipU32(offset),
    zipU16(0),
  ])
  return concatZipBytes([...localParts, centralDirectory, end])
}

export function createStoredZipBlob(entries: readonly StoredZipEntry[]) {
  return new Blob([encodeStoredZip(entries)], { type: "application/zip" })
}

export async function blobToZipEntry(name: string, blob: Blob): Promise<StoredZipEntry> {
  return {
    name,
    data: new Uint8Array(await blob.arrayBuffer()),
  }
}
