// Control-plane client for the Python ML plane (worker/ml/sealedai_ml/bridge.py): JSON lines over stdin/stdout,
// no sockets. Implements the agent's Trainer interface, so the loop drives real training.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DataSummary, Metrics, Recipe, Trainer, TrainResult } from '@sealedai/planner'

export type MlPlaneOptions = { mlDir?: string; python?: string }
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class MlPlane implements Trainer {
  private p: ChildProcessWithoutNullStreams
  private n = 0
  private pending = new Map<number, Pending>()
  private stderrTail: string[] = []

  constructor(o: MlPlaneOptions = {}) {
    const mlDir = resolve(o.mlDir ?? process.env.SEALEDAI_ML_DIR ?? join(import.meta.dirname, '../../../worker/ml'))
    const python = o.python ?? process.env.SEALEDAI_ML_PYTHON ?? join(mlDir, '.venv/bin/python')
    if (!existsSync(python)) throw new Error(`ML plane python not found at ${python} (run \`uv sync\` in worker/ml)`)
    this.p = spawn(python, ['-m', 'sealedai_ml.bridge'], { cwd: mlDir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } })
    createInterface({ input: this.p.stdout }).on('line', (line) => {
      const msg = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }
      const w = this.pending.get(msg.id)
      if (!w) return
      this.pending.delete(msg.id)
      if (msg.ok) w.resolve(msg.result)
      else w.reject(new Error(`ML plane: ${msg.error}`))
    })
    createInterface({ input: this.p.stderr }).on('line', (l) => { this.stderrTail = [...this.stderrTail.slice(-30), l] })
    this.p.on('exit', (code) => {
      for (const w of this.pending.values()) w.reject(new Error(`ML plane exited (${code}): ${this.stderrTail.slice(-5).join(' | ')}`))
      this.pending.clear()
    })
  }

  private call<T>(op: string, args: object = {}): Promise<T> {
    const id = ++this.n
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.p.stdin.write(JSON.stringify({ id, op, ...args }) + '\n')
    })
  }

  loadModel(dir: string) {
    return this.call<{ architecture: string; parameters: number; labels: string[] }>('load_model', { dir: resolve(dir) })
  }
  loadData(rows: { text: string; label: string }[], seed: string) {
    return this.call<{ summary: DataSummary; holdoutRows: number }>('load_data', { rows, seed })
  }
  baseline() {
    return this.call<Metrics>('baseline')
  }
  train(recipe: Recipe, runId: string, gpuSecondsLeft: number) {
    return this.call<TrainResult>('train', { runId, recipe, gpuSecondsLeft })
  }
  holdout(runId: string) {
    return this.call<Metrics>('holdout', { runId })
  }
  predict(runId: string, text: string) {
    return this.call<{ label: string }>('predict', { runId, text })
  }
  close() {
    this.p.stdin.end()
  }
}
