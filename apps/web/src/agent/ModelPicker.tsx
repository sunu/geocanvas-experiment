import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CaretDownIcon, CheckIcon, CircleNotchIcon, EyeIcon, EyeSlashIcon, GlobeIcon, HardDriveIcon, HardDrivesIcon, KeyIcon, TerminalWindowIcon, type Icon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Which model answers the agent: the flow of the Figma file's model screens (Model Menu, then Model Setup).
 * Only the interface is built. Nothing is saved, checked or downloaded yet: the Ollama check and the model
 * download are stand-ins that move through their states so that every screen can be seen, and the choice is
 * not yet what the chat's agent uses.
 */

type ModelId = 'backend' | 'key' | 'ollama' | 'browser'

const OPTIONS: { id: ModelId; title: string; hint: string; Icon: Icon }[] = [
  { id: 'backend', title: 'Model on backend', hint: 'Managed for you, no setup needed', Icon: HardDrivesIcon },
  { id: 'key', title: 'Bring your own key', hint: 'Use your Claude, Gemini or OpenAI key', Icon: KeyIcon },
  { id: 'ollama', title: 'Ollama (local)', hint: 'Runs on your machine at localhost', Icon: HardDriveIcon },
  { id: 'browser', title: 'Small model in browser', hint: 'Runs offline in your browser, private', Icon: GlobeIcon },
]

const PROVIDERS = ['Claude', 'Gemini', 'OpenAI']
const OLLAMA_MODELS = ['llama3.2:3b', 'qwen2.5:7b', 'mistral:7b']
/** The download's size, for the progress; the figures are the Figma file's. */
const DOWNLOAD_MB = 900

/** The menu opens beside the Ask panel, to its right, so it never covers the panel or the title bar. */
export function ModelPicker() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  /** The model in use. */
  const [model, setModel] = useState<ModelId>('backend')
  /** The model whose setup is open beside the menu. */
  const [setup, setSetup] = useState<ModelId | null>(null)
  const [provider, setProvider] = useState(PROVIDERS[0]!)
  const [ollamaModel, setOllamaModel] = useState(OLLAMA_MODELS[0]!)
  const current = OPTIONS.find((o) => o.id === model)!

  function close() {
    setOpen(false)
    setSetup(null)
  }
  // Closes on a press outside or Escape. A Select's list is drawn outside this element, so it counts as inside.
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      const t = e.target as Element
      if (!root.current?.contains(t) && !t.closest('[data-slot=select-content]')) close()
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function choose(id: ModelId) {
    if (id === 'backend') {
      setModel(id)
      close()
    } else setSetup(id)
  }
  function use(id: ModelId) {
    setModel(id)
    close()
  }

  const label = model === 'key' ? `Own key · ${provider}` : model === 'ollama' ? `Ollama · ${ollamaModel}` : current.title

  return (
    <div ref={root}>
      <Button
        variant="ghost"
        className="h-auto gap-1 px-1.5 py-1 text-[11px] font-normal text-muted-foreground"
        title="Which model answers"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <current.Icon className="size-3.5" />
        <span className="mr-0.5">{label}</span>
        <CaretDownIcon className="size-2.5" />
      </Button>
      {/* Placed with CSS against the panel (the nearest positioned ancestor): beside it, bottom edges level. */}
      {open && (
        <div className="ttx-ui absolute bottom-0 left-full z-10 ml-3 flex items-start gap-3 font-sans">
          <Card className="w-[300px] gap-0.5 p-1" role="menu" aria-label="Run the model">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Run the model</p>
            {OPTIONS.map(({ id, title, hint, Icon }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={model === id}
                onClick={() => choose(id)}
                className={cn('flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', (setup ?? model) === id && 'bg-accent')}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm/5 font-medium text-popover-foreground">{title}</span>
                  <span className="text-xs/4 text-muted-foreground">{hint}</span>
                </span>
                {model === id && (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <CheckIcon className="size-3.5" />
                  </span>
                )}
              </button>
            ))}
            {/* Not a choice: a note on the other way in, so it is not a menu item. */}
            <div className="mt-0.5 flex items-start gap-3 border-t p-2 pt-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center">
                <TerminalWindowIcon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm/5 font-medium text-popover-foreground">Your coding agent (MCP)</span>
                <span className="text-xs/4 text-muted-foreground">Run npm run mcp, then add it to Claude Code or Codex</span>
              </span>
            </div>
          </Card>
          {setup === 'key' && <KeySetup provider={provider} onProvider={setProvider} onCancel={() => setSetup(null)} onSave={() => use('key')} />}
          {setup === 'ollama' && <OllamaSetup model={ollamaModel} onModel={setOllamaModel} onCancel={() => setSetup(null)} onUse={() => use('ollama')} />}
          {setup === 'browser' && <BrowserSetup onUse={() => use('browser')} />}
        </div>
      )}
    </div>
  )
}

/** A floating card, as the Figma menus and setups are. */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col rounded-lg border bg-popover text-popover-foreground shadow-[0_2px_2px_rgb(0_0_0/0.1),0_4px_3px_rgb(0_0_0/0.1)]', className)} {...props} />
}

/** The frame of every Model Setup: title row, description, body and footer buttons. */
function Setup({ Icon, title, description, footer, children }: { Icon: Icon; title: string; description: string; footer: ReactNode; children: ReactNode }) {
  return (
    <Card className="w-[300px] gap-3 p-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon className="size-4" />
          <h3 className="text-sm/[14px] font-medium">{title}</h3>
        </div>
        <p className="text-xs/4 text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
      <div className="flex items-center justify-end gap-2">{footer}</div>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs/4 text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** A Select styled as the Figma inputs: 8px radius, 14px medium text, a caret on the right. */
function Choice({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-auto w-full rounded-md py-1.5 text-sm font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The pill under a setup's fields: a dot or spinner, and what is happening. */
function Status({ tone, children }: { tone: 'busy' | 'ok' | 'bad'; children: ReactNode }) {
  return (
    <div className="flex w-fit items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm/5 font-medium text-foreground">
      {tone === 'busy' ? (
        <CircleNotchIcon className="size-3.5 animate-spin" />
      ) : (
        <span className={cn('size-2 rounded-full', tone === 'ok' ? 'bg-green-500' : 'bg-red-500')} />
      )}
      {children}
    </div>
  )
}

function KeySetup({ provider, onProvider, onCancel, onSave }: { provider: string; onProvider: (p: string) => void; onCancel: () => void; onSave: () => void }) {
  const [shown, setShown] = useState(false)
  const [apiKey, setApiKey] = useState('')
  return (
    <Setup
      Icon={KeyIcon}
      title="Bring your own key"
      description="Requests go straight from your browser to the provider."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save key</Button>
        </>
      }
    >
      <Field label="Provider">
        <Choice value={provider} options={PROVIDERS} onChange={onProvider} />
      </Field>
      <Field label="API key">
        <div className="relative">
          <Input
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            className="h-auto rounded-md py-1.5 pr-9 text-sm font-medium"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            aria-label={shown ? 'Hide key' : 'Show key'}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeSlashIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
          </Button>
        </div>
      </Field>
      <p className="text-xs/4 text-muted-foreground">Stored only in this browser. It is never sent to our servers.</p>
    </Setup>
  )
}

type OllamaStatus = 'checking' | 'unreachable' | 'connected'

function OllamaSetup({ model, onModel, onCancel, onUse }: { model: string; onModel: (m: string) => void; onCancel: () => void; onUse: () => void }) {
  const [url, setUrl] = useState('http://localhost:11434')
  const [status, setStatus] = useState<OllamaStatus>('checking')
  const [attempt, setAttempt] = useState(0)
  // A stand-in for the check: the first try fails and the second works, to show both screens.
  useEffect(() => {
    if (status !== 'checking') return
    const t = setTimeout(() => setStatus(attempt === 0 ? 'unreachable' : 'connected'), 1200)
    return () => clearTimeout(t)
  }, [status, attempt])
  return (
    <Setup
      Icon={HardDriveIcon}
      title="Ollama (local)"
      description="Connect to a model running on your machine."
      footer={
        status === 'checking' ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : status === 'unreachable' ? (
          <Button
            variant="outline"
            onClick={() => {
              setAttempt((a) => a + 1)
              setStatus('checking')
            }}
          >
            Retry
          </Button>
        ) : (
          <Button onClick={onUse}>Use this model</Button>
        )
      }
    >
      <Field label="Server URL">
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setAttempt(0)
            setStatus('checking')
          }}
          className="h-auto rounded-md py-1.5 text-sm font-medium"
        />
      </Field>
      {status === 'checking' && <Status tone="busy">Checking connection…</Status>}
      {status === 'unreachable' && (
        <>
          <Status tone="bad">Can't reach Ollama</Status>
          <p className="text-xs/4 text-muted-foreground">Start it with “ollama serve”, then allow this site with OLLAMA_ORIGINS.</p>
        </>
      )}
      {status === 'connected' && (
        <>
          <Status tone="ok">Connected · Ollama 0.5.1</Status>
          <Field label="Model">
            <Choice value={model} options={OLLAMA_MODELS} onChange={onModel} />
          </Field>
        </>
      )}
    </Setup>
  )
}

type DownloadState = 'idle' | 'downloading' | 'ready'

function BrowserSetup({ onUse }: { onUse: () => void }) {
  const [state, setState] = useState<DownloadState>('idle')
  const [mb, setMb] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  // A stand-in for the download: counts up, so that the progress and the ready screen can be seen.
  useEffect(() => () => clearInterval(timer.current), [])
  function download() {
    setState('downloading')
    setMb(0)
    timer.current = setInterval(() => {
      setMb((m) => {
        if (m + 30 < DOWNLOAD_MB) return m + 30
        clearInterval(timer.current)
        setState('ready')
        return DOWNLOAD_MB
      })
    }, 200)
  }
  function stop(next: DownloadState) {
    clearInterval(timer.current)
    setState(next)
  }
  return (
    <Setup
      Icon={GlobeIcon}
      title="Small model in browser"
      description="Runs offline on your device with WebGPU."
      footer={
        state === 'idle' ? (
          <Button onClick={download}>Download model</Button>
        ) : state === 'downloading' ? (
          <Button variant="ghost" size="sm" onClick={() => stop('idle')}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => stop('idle')}>
              Remove
            </Button>
            <Button onClick={onUse}>Use this model</Button>
          </>
        )
      }
    >
      <dl className="flex flex-col gap-1.5 text-xs/4">
        {[
          ['Model', 'Qwen 2.5 1.5B (q4)'],
          ['Size', `About ${DOWNLOAD_MB} MB`],
          ['Runs on', 'WebGPU'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {state === 'downloading' && (
        <>
          <Progress value={(mb / DOWNLOAD_MB) * 100} className="h-1.5" />
          <p className="text-xs/4 text-muted-foreground">
            Downloading… {mb} MB of {DOWNLOAD_MB} MB
          </p>
        </>
      )}
      {state === 'ready' && <Status tone="ok">Ready · cached on this device</Status>}
    </Setup>
  )
}
