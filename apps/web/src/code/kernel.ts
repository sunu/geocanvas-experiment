import type { CodeError } from '@ttx/plugins'

/**
 * A minimal client for a person's JupyterHub (plans/plan-018.md): the hub's REST API to find and start their
 * server, the server's REST API to start a kernel, and the Jupyter messaging protocol (v5) over the kernel's
 * WebSocket to run code, as MyST and thebe do. No @jupyterlab/services: we need one request and a few replies.
 * The hub and the server must allow CORS from the board's origin. The token goes only to the hub.
 */

export interface HubLogin {
  /** The hub's base URL, e.g. https://hub.example.org (without /hub). */
  url: string
  token: string
}

/** What one run gave: the output the preamble (ttx.py) sent, the error, and everything printed. */
export interface RawRun {
  output?: { kind: string; value: unknown }
  error?: CodeError
  stdout: string
  ms: number
}

const OUTPUT = 'application/vnd.ttx.output+json'
const ERROR = 'application/vnd.ttx.error+json'
/** How long a server may take to start. */
const SPAWN_TIMEOUT_MS = 180_000

/** A hub URL as people paste it: with or without /hub, /hub/home or a trailing slash. */
export const hubBase = (url: string) => url.trim().replace(/\/+$/, '').replace(/\/hub(\/.*)?$/, '')

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

export class HubError extends Error {}

interface HubUser {
  name: string
  /** The server's path, e.g. /user/alice/, once it runs. */
  server: string | null
  pending: string | null
}

/** One person's hub: their user, their server (started when needed) and one kernel on it, for this tab. */
export class JupyterSession {
  private readonly login: HubLogin
  private readonly preamble: string
  private readonly base: string
  private serverUrl?: string
  private kernel?: Promise<KernelSocket>
  /** Runs one at a time, as a kernel does. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(login: HubLogin, preamble: string) {
    this.login = login
    this.preamble = preamble
    this.base = hubBase(login.url)
  }

  private async hub<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}/hub/api${path}`, { ...init, headers: { authorization: `token ${this.login.token}`, ...init.headers } })
    if (res.status === 403 || res.status === 401) throw new HubError('The hub refused the token: make a new one on its Token page.')
    if (!res.ok) throw new HubError(`The hub answered ${res.status} for ${path}`)
    // Starting a server answers 201 or 202 with no body.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Who the token belongs to. Also checks the hub can be reached from here (CORS). */
  async user(): Promise<HubUser> {
    try {
      return await this.hub<HubUser>('/user')
    } catch (err) {
      if (err instanceof HubError) throw err
      throw new HubError(`Cannot reach the hub at ${this.base}. Is it up, and does it allow this site (CORS)?`)
    }
  }

  /**
   * A request to the person's server. The browser hides why a request failed; with the hub reachable, the likely
   * reason is that the server does not allow this site (its own CORS list, apart from the hub's).
   */
  private async serverFetch(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(url, { ...init, headers: { authorization: `token ${this.login.token}`, ...init.headers } })
    } catch {
      throw new HubError(`Your server on ${this.base} does not allow this site (${globalThis.location?.origin}). The hub's admin must add it to the servers' allowed origins (extras/jupyterhub/README.md), then restart your server.`)
    }
  }

  /** Check that the person's server, if it runs, lets this site in: the hub can, while the server does not. */
  async checkServer(): Promise<void> {
    const user = await this.user()
    if (user.server) await this.serverFetch(`${new URL(user.server, `${this.base}/`).href.replace(/\/+$/, '')}/api/status`)
  }

  /** The person's server, started if it is not running. */
  private async server(onStatus?: (s: string) => void): Promise<string> {
    if (this.serverUrl) return this.serverUrl
    let user = await this.user()
    if (!user.server && !user.pending) {
      onStatus?.('Starting your server…')
      await this.hub(`/users/${encodeURIComponent(user.name)}/server`, { method: 'POST' })
    }
    const until = Date.now() + SPAWN_TIMEOUT_MS
    while (!user.server) {
      if (Date.now() > until) throw new HubError('Your server did not start in time. Try again, or start it from the hub.')
      onStatus?.('Starting your server…')
      await new Promise((r) => setTimeout(r, 1000))
      user = await this.user()
    }
    this.serverUrl = new URL(user.server, `${this.base}/`).href.replace(/\/+$/, '')
    return this.serverUrl
  }

  private async startKernel(onStatus?: (s: string) => void): Promise<KernelSocket> {
    const server = await this.server(onStatus)
    onStatus?.('Starting a kernel…')
    const res = await this.serverFetch(`${server}/api/kernels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'python3' }),
    })
    if (res.status === 404 || res.status === 503) {
      // The server stopped (culled) since we found it.
      this.serverUrl = undefined
      throw new HubError('Your server stopped. Run again to start it.')
    }
    if (!res.ok) throw new HubError(`Your server answered ${res.status} when starting a kernel`)
    const { id } = (await res.json()) as { id: string }
    const kernel = await KernelSocket.open(server, id, this.login.token)
    const mine = this.kernel
    // A kernel that dies (restarted, culled) is replaced on the next run.
    kernel.onClose = () => {
      if (this.kernel === mine) this.kernel = undefined
    }
    const setup = await kernel.execute(this.preamble, 30_000)
    if (setup.error) throw new HubError(`The kernel could not set up: ${setup.error.ename}: ${setup.error.evalue}`)
    return kernel
  }

  /** Run a cell's code. Never throws for the code's own errors: they come back in `error`. */
  run(source: string, opts: { timeoutMs: number; onStatus?: (s: string) => void }): Promise<RawRun> {
    const next = this.queue.then(async () => {
      if (!this.kernel) {
        const starting = this.startKernel(opts.onStatus)
        this.kernel = starting
        starting.catch(() => {
          if (this.kernel === starting) this.kernel = undefined
        })
      }
      const kernel = await this.kernel
      opts.onStatus?.('Running…')
      const started = performance.now()
      const run = await kernel.execute(`_ttx_run(${JSON.stringify(toBase64(source))})`, opts.timeoutMs)
      if (run.timedOut) {
        // Interrupted, but it may not stop: a fresh kernel for the next run.
        this.kernel = undefined
        void kernel.shutdown(this.serverUrl!, this.login.token)
        return { stdout: run.stdout, ms: performance.now() - started, error: { ename: 'Timeout', evalue: `The code ran for more than ${Math.round(opts.timeoutMs / 1000)} s and was stopped.`, traceback: [] } }
      }
      return { ...run, ms: performance.now() - started }
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Stop this tab's kernel, e.g. when the page goes away. */
  close() {
    const kernel = this.kernel
    this.kernel = undefined
    if (kernel && this.serverUrl) void kernel.then((k) => k.shutdown(this.serverUrl!, this.login.token)).catch(() => undefined)
  }
}

interface Pending {
  output?: RawRun['output']
  error?: CodeError
  stdout: string
  replied: boolean
  idle: boolean
  done(result: Omit<RawRun, 'ms'> & { timedOut?: boolean }): void
}

/** One kernel's WebSocket: sends execute requests and gathers the replies to each. */
class KernelSocket {
  onClose?: () => void
  private pending = new Map<string, Pending>()
  private readonly session = crypto.randomUUID()
  private readonly ws: WebSocket
  private readonly server: string
  private readonly id: string
  private readonly token: string

  private constructor(ws: WebSocket, server: string, id: string, token: string) {
    this.ws = ws
    this.server = server
    this.id = id
    this.token = token
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as Message)
    ws.onclose = () => {
      for (const p of this.pending.values()) p.done({ stdout: p.stdout, error: { ename: 'KernelDied', evalue: 'The connection to the kernel closed. Run again.', traceback: [] } })
      this.pending.clear()
      this.onClose?.()
    }
  }

  static open(server: string, id: string, token: string): Promise<KernelSocket> {
    const url = `${server.replace(/^http/, 'ws')}/api/kernels/${id}/channels?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(new KernelSocket(ws, server, id, token))
      ws.onerror = () => reject(new HubError('Cannot connect to the kernel'))
    })
  }

  execute(code: string, timeoutMs: number): Promise<Omit<RawRun, 'ms'> & { timedOut?: boolean }> {
    const msgId = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        void fetch(`${this.server}/api/kernels/${this.id}/interrupt`, { method: 'POST', headers: { authorization: `token ${this.token}` } }).catch(() => undefined)
        p.done({ stdout: p.stdout, timedOut: true })
      }, timeoutMs)
      const p: Pending = {
        stdout: '',
        replied: false,
        idle: false,
        done: (result) => {
          clearTimeout(timer)
          this.pending.delete(msgId)
          resolve(result)
        },
      }
      this.pending.set(msgId, p)
      this.ws.send(
        JSON.stringify({
          header: { msg_id: msgId, msg_type: 'execute_request', username: 'ttx', session: this.session, date: new Date().toISOString(), version: '5.3' },
          parent_header: {},
          metadata: {},
          channel: 'shell',
          content: { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: true },
        }),
      )
    })
  }

  private receive(m: Message) {
    const p = this.pending.get(m.parent_header?.msg_id ?? '')
    if (!p) return
    const c = m.content
    switch (m.msg_type) {
      case 'stream':
        p.stdout += c.text ?? ''
        break
      case 'display_data':
      case 'execute_result':
        if (c.data?.[OUTPUT]) p.output = c.data[OUTPUT] as RawRun['output']
        if (c.data?.[ERROR]) p.error = c.data[ERROR] as CodeError
        break
      case 'error':
        // Outside the preamble's own handling, e.g. the preamble itself failed.
        p.error = { ename: c.ename ?? 'Error', evalue: c.evalue ?? '', traceback: c.traceback ?? [] }
        break
      case 'execute_reply':
        p.replied = true
        break
      case 'status':
        if (c.execution_state === 'idle') p.idle = true
        break
    }
    // Every output comes before the kernel goes idle, which may come after the reply.
    if (p.replied && p.idle) p.done({ stdout: p.stdout, ...(p.output && { output: p.output }), ...(p.error && { error: p.error }) })
  }

  async shutdown(server: string, token: string) {
    this.ws.onclose = null
    this.ws.close()
    await fetch(`${server}/api/kernels/${this.id}`, { method: 'DELETE', headers: { authorization: `token ${token}` }, keepalive: true }).catch(() => undefined)
  }
}

interface Message {
  msg_type: string
  parent_header?: { msg_id?: string }
  content: { text?: string; data?: Record<string, unknown>; ename?: string; evalue?: string; traceback?: string[]; execution_state?: string }
}
