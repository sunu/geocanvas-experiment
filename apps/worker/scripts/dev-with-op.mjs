import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(workerDir, '../..')
const template = path.join(workerDir, '.dev.vars.tpl')
const devVars = path.join(workerDir, '.dev.vars')

// Without a 1Password template, preserve the ordinary Wrangler .dev.vars workflow.
if (!fs.existsSync(template)) {
  runWorker()
} else {
  const injected = path.join(workerDir, `.dev.vars.injected-${process.pid}`)
  const original = fs.existsSync(devVars) ? fs.readFileSync(devVars) : undefined
  const result = spawnSync('op', ['inject', '--in-file', template, '--out-file', injected], { cwd: repo, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)

  const extra = fs.readFileSync(injected, 'utf8').split(/\r?\n/)
  const keys = new Set(extra.map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]).filter(Boolean))
  const base = original?.toString('utf8').split(/\r?\n/) ?? []
  const merged = [...base.filter((line) => !keys.has(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])), ...extra]
    .join('\n')
    .replace(/\n*$/, '\n')

  fs.writeFileSync(devVars, merged, { mode: 0o600 })
  fs.rmSync(injected, { force: true })

  const restore = () => {
    if (original === undefined) fs.rmSync(devVars, { force: true })
    else fs.writeFileSync(devVars, original, { mode: 0o600 })
  }

  runWorker(restore)
}

function runWorker(restore = () => {}) {
  const child = spawn('npm', ['run', 'dev', '-w', 'apps/worker'], { cwd: repo, stdio: 'inherit', env: process.env })
  let restored = false
  const finish = (code, signal) => {
    if (restored) return
    restored = true
    restore()
    process.exitCode = code ?? (signal ? 1 : 0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.once('error', (error) => {
    console.error(error)
    finish(1)
  })
  child.once('exit', finish)
}
