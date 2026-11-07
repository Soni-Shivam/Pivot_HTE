import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The demo suite's ego is IDM in these two source files. This is a source commitment,
// not remote attestation that an arbitrary customer's binary executed.
export function kinematicPolicyCommitment() {
  const hash = createHash('sha256').update('faultline-kinematic-idm-v1\0')
  for (const file of ['faultline/controller.py', 'faultline/cutin.py'])
    hash.update(file).update('\0').update(readFileSync(resolve(file)))
  return `0x${hash.digest('hex')}`
}
