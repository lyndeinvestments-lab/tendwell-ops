// Read the first worksheet of an .xlsx file in the browser, with no library:
// an .xlsx is a zip of XML files, the browser's DecompressionStream inflates
// its entries and DOMParser reads the XML. Enough for simple sheets (text,
// numbers, dates as serials); formulas come through as their cached value.

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Every xl/ file in the zip, by name (read from the central directory, so
 *  entries written with a trailing data descriptor are handled). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not an .xlsx file')
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  const out = new Map<string, Uint8Array>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('Damaged .xlsx file')
    const method = u16(b, p + 10)
    const compSize = u32(b, p + 20)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen))
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    const raw = b.subarray(start, start + compSize)
    if (name.startsWith('xl/')) out.set(name, method === 0 ? raw : method === 8 ? await inflateRaw(raw) : new Uint8Array())
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Rows of the first worksheet: strings, or numbers for numeric cells. */
export async function readXlsxFirstSheet(file: Blob): Promise<Array<Array<string | number | null>>> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read .xlsx files; save the sheet as .csv and import that')
  const files = await unzip(await file.arrayBuffer())
  const xml = (name: string) => {
    const f = files.get(name)
    return f ? new DOMParser().parseFromString(new TextDecoder().decode(f), 'application/xml') : null
  }
  const shared: string[] = []
  const ss = xml('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(ss.getElementsByTagName('si'))) {
    shared.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent ?? '').join(''))
  }
  const sheetName = Array.from(files.keys()).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0]
  const sheet = sheetName ? xml(sheetName) : null
  if (!sheet) throw new Error('No worksheet found in the file')
  const rows: Array<Array<string | number | null>> = []
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const out: Array<string | number | null> = []
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const i = colIndex(c.getAttribute('r') ?? '')
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null
      let val: string | number | null = null
      if (t === 's' && v != null) val = shared[Number(v)] ?? null
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(x => x.textContent ?? '').join('')
      else if (t === 'str' || t === 'b' || t === 'e') val = v
      else if (v != null) val = Number.isFinite(Number(v)) ? Number(v) : v
      while (out.length < i) out.push(null)
      out[i] = val
    }
    rows.push(out)
  }
  return rows
}
