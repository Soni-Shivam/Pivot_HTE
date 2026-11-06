// Deterministic flat tar (ustar) for model bundles (PROTOCOL §4): sorted names, zero mtime/uid/gid, mode 0644.
// The reader accepts only plain files with flat names, so a bundle can never write outside its directory.
const BLOCK = 512

function header(name: string, size: number) {
  const h = new Uint8Array(BLOCK)
  const put = (s: string, off: number, len: number) => h.set(new TextEncoder().encode(s).subarray(0, len), off)
  put(name, 0, 100)
  put('0000644\0', 100, 8)
  put('0000000\0', 108, 8)
  put('0000000\0', 116, 8)
  put(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  put('00000000000\0', 136, 12)
  put('        ', 148, 8)
  put('0', 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  const sum = h.reduce((a, b) => a + b, 0)
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

const safeName = (n: string) => /^[A-Za-z0-9._-]{1,100}$/.test(n) && n !== '.' && n !== '..'

export function packTar(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1))
  const parts: Uint8Array[] = []
  for (const f of sorted) {
    if (!safeName(f.name)) throw new Error(`invalid bundle file name ${f.name}`)
    parts.push(header(f.name, f.data.length), f.data, new Uint8Array((BLOCK - (f.data.length % BLOCK)) % BLOCK))
  }
  parts.push(new Uint8Array(BLOCK * 2))
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export function unpackTar(buf: Uint8Array): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = []
  let o = 0
  while (o + BLOCK <= buf.length) {
    const h = buf.subarray(o, o + BLOCK)
    if (h.every((b) => b === 0)) break
    const str = (off: number, len: number) => new TextDecoder().decode(h.subarray(off, off + len)).replace(/\0.*$/s, '')
    const name = str(0, 100)
    const type = str(156, 1) || '0'
    const size = parseInt(str(124, 12).trim(), 8)
    if (type !== '0' || !safeName(name) || !Number.isFinite(size)) throw new Error(`refusing tar entry ${JSON.stringify(name)} (type ${type})`)
    if (o + BLOCK + size > buf.length) throw new Error('truncated tar')
    files.push({ name, data: buf.slice(o + BLOCK, o + BLOCK + size) })
    o += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return files
}
