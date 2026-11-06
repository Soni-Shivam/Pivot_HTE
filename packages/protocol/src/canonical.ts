// RFC 8785 (JCS) canonical JSON, UTF-8 encoded. Used for every hashed or signed JSON object.
import canonicalize from 'canonicalize'

export function canonical(v: unknown): Uint8Array {
  const s = canonicalize(v)
  if (s === undefined) throw new Error('value cannot be canonicalized')
  return new TextEncoder().encode(s)
}
