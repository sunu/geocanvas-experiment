import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CaretDownIcon, CaretUpDownIcon, CheckIcon, CircleNotchIcon, EyeIcon, EyeSlashIcon, GlobeIcon, HardDriveIcon, HardDrivesIcon, KeyIcon, TerminalWindowIcon, type Icon } from '@phosphor-icons/react'
import { OPENROUTER_URL } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  BROWSER_MODELS,
  browserModel,
  CONTEXTS,
  DEFAULT_CONTEXT,
  DEFAULT_MODEL,
  keyIsUsable,
  listModels,
  LOCAL_SERVERS,
  SUGGESTED_MODELS,
  type AgentMode,
  type KeyConfig,
  type LocalServer,
  type ModelInfo,
} from './keys'
import { describeLoadError, isCached, isLoading, loadModel, removeModel, storageShort, unloadModel, webGpuMissing } from './webllm'

/**
 * Which model answers the agent: the flow of the Figma file's model screens (Model Menu, then Model Setup).
 * The room's model, the person's own key (OpenRouter or any OpenAI-compatible API) and a local server are saved
 * in this browser (keys.ts) and used by the chat. The small model in the browser is downloaded once and runs in
 * this tab (webllm.ts).
 */

type ModelId = 'backend' | 'key' | 'local' | 'browser'

const OPTIONS: { id: ModelId; title: string; hint: string; Icon: Icon }[] = [
  { id: 'backend', title: 'Model on backend', hint: 'Managed for you, no setup needed', Icon: HardDrivesIcon },
  { id: 'key', title: 'Bring your own key', hint: 'OpenRouter or any OpenAI-compatible API', Icon: KeyIcon },
  { id: 'local', title: 'Local model', hint: 'Ollama, LM Studio, llama.cpp or your own server', Icon: HardDriveIcon },
  { id: 'browser', title: 'Small model in browser', hint: 'Runs offline in your browser, private', Icon: GlobeIcon },
]

const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
]
const SERVERS = Object.entries(LOCAL_SERVERS).map(([value, { label }]) => ({ value, label }))

/** What the footer says: where the model runs, and which. */
function describe(model: ModelId, config: KeyConfig | null): string {
  if (model === 'key' && config) return `${config.provider === 'openrouter' ? 'OpenRouter' : 'Own key'} · ${config.model}`
  if (model === 'local' && config) return `${LOCAL_SERVERS[config.server ?? 'custom'].label} · ${config.model}`
  if (model === 'browser' && config) return `In browser · ${browserModel(config.model)?.short ?? config.model}`
  return OPTIONS.find((o) => o.id === model)!.title
}

/**
 * The menu opens beside the Ask panel, to its right, so it never covers the panel or the title bar.
 * `onUse` switches the agent (and saves `config`, when given); `onForget` removes the saved key.
 */
export function ModelPicker({
  mode,
  config,
  onUse,
  onForget,
}: {
  mode: AgentMode
  config: KeyConfig | null
  onUse(mode: AgentMode, config?: KeyConfig): void
  onForget(): void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  /** The model in use. */
  const model: ModelId = mode === 'room' ? 'backend' : config?.provider === 'local' ? 'local' : config?.provider === 'browser' ? 'browser' : 'key'
  /** The model whose setup is open beside the menu. */
  const [setup, setSetup] = useState<ModelId | null>(null)
  const current = OPTIONS.find((o) => o.id === model)!

  function close() {
    setOpen(false)
    setSetup(null)
  }
  // Closes on a press outside or Escape. A Select's list and the model list are drawn outside this element, so they
  // count as inside; Escape in the model list closes only the list.
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      const t = e.target as Element
      if (!root.current?.contains(t) && !t.closest('[data-slot=select-content], [data-slot=popover-content]')) close()
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as Element).closest?.('[data-slot=popover-content]') && close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function choose(id: ModelId) {
    if (id === 'backend') {
      onUse('room')
      close()
    } else setSetup(id)
  }
  function use(config: KeyConfig) {
    onUse('own', config)
    close()
  }

  return (
    <div ref={root}>
      <Button
        variant="ghost"
        className="h-auto max-w-full gap-1 px-1.5 py-1 text-[11px] font-normal text-muted-foreground"
        title="Which model answers"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <current.Icon className="size-3.5" />
        <span className="mr-0.5 truncate">{describe(model, config)}</span>
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
          {setup === 'key' && (
            <KeySetup
              saved={config?.provider === 'local' || config?.provider === 'browser' ? null : config}
              onCancel={() => setSetup(null)}
              onSave={use}
              onForget={() => {
                onForget()
                close()
              }}
            />
          )}
          {setup === 'local' && <LocalSetup saved={config?.provider === 'local' ? config : null} onCancel={() => setSetup(null)} onUse={use} />}
          {setup === 'browser' && <BrowserSetup saved={config?.provider === 'browser' ? config : null} onUse={use} />}
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
function Choice({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-auto w-full rounded-md py-1.5 text-sm font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const TEXT = 'h-auto rounded-md py-1.5 text-sm font-medium'

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

/** An API key, hidden until shown. */
function KeyInput({ value, onChange, placeholder }: { value: string; onChange: (key: string) => void; placeholder: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(TEXT, 'pr-9')} />
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
  )
}

/** OpenRouter, or any OpenAI-compatible API at a base URL. `saved` is the key saved for either, if any. */
function KeySetup({ saved, onCancel, onSave, onForget }: { saved: KeyConfig | null; onCancel: () => void; onSave: (config: KeyConfig) => void; onForget: () => void }) {
  const [config, setConfig] = useState<KeyConfig>(() => saved ?? { provider: 'openrouter', url: OPENROUTER_URL, model: DEFAULT_MODEL, apiKey: '' })
  const set = (fields: Partial<KeyConfig>) => setConfig((c) => ({ ...c, ...fields }))
  const openRouter = config.provider === 'openrouter'
  const valid = keyIsUsable(config)
  // OpenRouter lists its models without a key; another provider may need it.
  const list = useModels(openRouter ? OPENROUTER_URL : config.url, openRouter ? '' : config.apiKey)
  return (
    <Setup
      Icon={KeyIcon}
      title="Bring your own key"
      description="Requests go straight from your browser to the provider."
      footer={
        <>
          {saved ? (
            <Button variant="ghost" size="sm" className="mr-auto" onClick={onForget}>
              Forget key
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ ...config, url: config.url.trim(), model: config.model.trim(), apiKey: config.apiKey.trim() })}>
            Save key
          </Button>
        </>
      }
    >
      <Field label="Provider">
        <Choice
          value={config.provider}
          options={PROVIDERS}
          onChange={(p) => set(p === 'openrouter' ? { provider: 'openrouter', url: OPENROUTER_URL } : { provider: 'openai-compatible', url: config.url === OPENROUTER_URL ? '' : config.url })}
        />
      </Field>
      {!openRouter && (
        <Field label="Base URL">
          <Input value={config.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.openai.com/v1" className={TEXT} />
        </Field>
      )}
      <Field label="Model">
        <ModelCombobox value={config.model} onChange={(model) => set({ model })} models={list.models} loading={list.status === 'checking'} suggested={openRouter ? SUGGESTED_MODELS : []} />
      </Field>
      <Field label="API key">
        <KeyInput value={config.apiKey} onChange={(apiKey) => set({ apiKey })} placeholder={openRouter ? 'sk-or-…' : 'sk-…'} />
      </Field>
      <p className="text-xs/4 text-muted-foreground">Stored only in this browser. It is sent only to {openRouter ? 'OpenRouter' : config.url.trim() || 'the URL above'}, never to our servers.</p>
    </Setup>
  )
}

/** "1M ctx · $0.50/M in": what OpenRouter says of a model, if anything. */
function modelFacts({ context, price }: ModelInfo): string {
  const facts: string[] = []
  if (context) facts.push(`${context >= 1e6 ? `${+(context / 1e6).toFixed(1)}M` : `${Math.round(context / 1e3)}K`} ctx`)
  if (price !== undefined) facts.push(price === 0 ? 'free' : `$${price < 0.1 ? +price.toFixed(3) : price.toFixed(2)}/M in`)
  return facts.join(' · ')
}

function ModelItem({ model, selected, onSelect }: { model: ModelInfo; selected: boolean; onSelect: () => void }) {
  const facts = modelFacts(model)
  return (
    <CommandItem value={model.id} keywords={model.name ? [model.name] : undefined} onSelect={onSelect}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{model.name ?? model.id}</span>
        <span className="truncate text-xs text-muted-foreground">
          {model.name ? model.id : null}
          {model.name && facts ? ' · ' : null}
          {facts}
        </span>
      </span>
      {selected && <CheckIcon className="size-3.5" />}
    </CommandItem>
  )
}

/**
 * A model from the server's list, searched by id or name, or any id typed in: a model the list does not have, or a
 * server that gives none. `suggested` ids come first, those in the list only once it has loaded.
 */
function ModelCombobox({ value, onChange, models, loading, suggested }: { value: string; onChange: (id: string) => void; models: ModelInfo[]; loading: boolean; suggested: string[] }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const byId = new Map(models.map((m) => [m.id, m]))
  const top = suggested.flatMap((id) => (models.length ? (byId.has(id) ? [byId.get(id)!] : []) : [{ id }]))
  const rest = models.filter((m) => !suggested.includes(m.id))
  const typed = search.trim()
  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setSearch('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn(TEXT, 'w-full justify-between px-3 font-medium')}>
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{(value && byId.get(value)?.name) || value || 'Choose a model'}</span>
          <CaretUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[280px] p-0">
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search or type a model id…" />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading models…' : 'No model found.'}</CommandEmpty>
            {typed && !byId.has(typed) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`use:${typed}`} onSelect={() => pick(typed)}>
                  Use “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            {top.length > 0 && (
              <CommandGroup heading="Suggested">
                {top.map((m) => (
                  <ModelItem key={m.id} model={m} selected={m.id === value} onSelect={() => pick(m.id)} />
                ))}
              </CommandGroup>
            )}
            {rest.length > 0 && (
              <CommandGroup heading={top.length ? 'All models' : undefined}>
                {rest.map((m) => (
                  <ModelItem key={m.id} model={m} selected={m.id === value} onSelect={() => pick(m.id)} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type ListStatus = 'idle' | 'checking' | 'unreachable' | 'connected'

/** A server's models (listModels), asked again a moment after the URL or key stops changing; `retry` asks again now. */
function useModels(url: string, apiKey: string) {
  const [state, setState] = useState<{ status: ListStatus; models: ModelInfo[] }>({ status: 'idle', models: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const base = url.trim()
    if (!/^https?:\/\/\S/.test(base)) return setState({ status: 'idle', models: [] })
    setState((s) => ({ ...s, status: 'checking' }))
    const abort = new AbortController()
    const t = setTimeout(() => {
      listModels(base, apiKey, abort.signal).then(
        (models) => setState({ status: 'connected', models }),
        () => !abort.signal.aborted && setState({ status: 'unreachable', models: [] }),
      )
    }, 400)
    return () => {
      clearTimeout(t)
      abort.abort()
    }
  }, [url, apiKey, attempt])
  return { ...state, retry: () => setAttempt((a) => a + 1) }
}

/** A server on this machine: picks its default URL, checks that it answers, and lists its models. */
function LocalSetup({ saved, onCancel, onUse }: { saved: KeyConfig | null; onCancel: () => void; onUse: (config: KeyConfig) => void }) {
  const [server, setServer] = useState<LocalServer>(saved?.server ?? 'ollama')
  const [url, setUrl] = useState(saved?.url ?? LOCAL_SERVERS.ollama.url)
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? '')
  const [model, setModel] = useState(saved?.model ?? '')
  const { status, models, retry } = useModels(url, apiKey)
  const { label, hint } = LOCAL_SERVERS[server]
  // Once connected, a model the server does not have gives way to its first one.
  useEffect(() => {
    if (models.length && !models.some((m) => m.id === model)) setModel(models[0]!.id)
  }, [models, model])

  const config: KeyConfig = { provider: 'local', server, url: url.trim(), model: model.trim(), apiKey: apiKey.trim() }
  return (
    <Setup
      Icon={HardDriveIcon}
      title="Local model"
      description="Connect to a model running on your machine."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {status === 'unreachable' ? (
            <Button variant="outline" onClick={retry}>
              Retry
            </Button>
          ) : (
            <Button disabled={status !== 'connected' || !keyIsUsable(config)} onClick={() => onUse(config)}>
              Use this model
            </Button>
          )}
        </>
      }
    >
      <Field label="Server">
        <Choice
          value={server}
          options={SERVERS}
          onChange={(s) => {
            const next = s as LocalServer
            setServer(next)
            if (next !== 'custom') setUrl(LOCAL_SERVERS[next].url)
          }}
        />
      </Field>
      <Field label="Server URL">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000/v1" className={TEXT} />
      </Field>
      {server === 'custom' && (
        <Field label="API key (optional)">
          <KeyInput value={apiKey} onChange={setApiKey} placeholder="Not needed for most local servers" />
        </Field>
      )}
      {status === 'checking' && <Status tone="busy">Checking connection…</Status>}
      {status === 'unreachable' && (
        <>
          <Status tone="bad">Can't reach {label}</Status>
          <p className="text-xs/4 text-muted-foreground">{hint}</p>
        </>
      )}
      {status === 'connected' && (
        <>
          <Status tone="ok">
            Connected · {models.length ? `${models.length} model${models.length === 1 ? '' : 's'}` : 'no models listed'}
          </Status>
          <Field label="Model">
            {models.length ? (
              <Choice value={model} options={models.map((m) => ({ value: m.id, label: m.id }))} onChange={setModel} />
            ) : (
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" className={TEXT} />
            )}
          </Field>
        </>
      )}
    </Setup>
  )
}

type DownloadState = 'checking' | 'unsupported' | 'idle' | 'downloading' | 'ready' | 'error'

const gb = (mb: number) => `${(mb / 1000).toFixed(1)} GB`

/** A model that runs in this tab on WebGPU (webllm.ts): download it once, then use it. */
function BrowserSetup({ saved, onUse }: { saved: KeyConfig | null; onUse: (config: KeyConfig) => void }) {
  // A model saved before it left the list (the 2B) gives way to the one there is.
  const modelId = saved && browserModel(saved.model) ? saved.model : BROWSER_MODELS[0]!.id
  const [context, setContext] = useState(saved?.context ?? DEFAULT_CONTEXT)
  const [state, setState] = useState<DownloadState>('checking')
  const [progress, setProgress] = useState<{ value: number; text: string }>({ value: 0, text: '' })
  const [error, setError] = useState('')
  const model = browserModel(modelId)!
  // Each download or check; an answer for an older one (another model, or cancelled) is dropped.
  const attempt = useRef(0)

  async function download() {
    const n = ++attempt.current
    setState('downloading')
    setProgress({ value: 0, text: '' })
    const fail = (message: string) => {
      if (n !== attempt.current) return
      setError(message)
      setState('error')
    }
    // A model loaded before is read from the cache, so it needs no more room.
    const short = (await isCached(modelId)) ? null : await storageShort(model.mb)
    if (short) return fail(short)
    if (n !== attempt.current) return
    loadModel(modelId, context, (r) => n === attempt.current && setProgress({ value: r.progress, text: r.text })).then(
      () => n === attempt.current && setState('ready'),
      (err) => fail(describeLoadError(err)),
    )
  }
  // WebGPU first, then whether the model is here already, or downloading since the menu was last open.
  useEffect(() => {
    const n = ++attempt.current
    setState('checking')
    webGpuMissing()
      .then(async (missing) => {
        if (n !== attempt.current) return
        if (missing) {
          setError(missing)
          return setState('unsupported')
        }
        if (isLoading(modelId, context)) return download()
        const cached = await isCached(modelId)
        if (n === attempt.current) setState(cached ? 'ready' : 'idle')
      })
      .catch(() => n === attempt.current && setState('idle'))
  }, [modelId, context])

  function cancel() {
    attempt.current++
    unloadModel()
    setState('idle')
  }
  async function remove() {
    attempt.current++
    await removeModel(modelId)
    setState('idle')
  }
  const busy = state === 'checking' || state === 'downloading'
  return (
    <Setup
      Icon={GlobeIcon}
      title="Small model in browser"
      description="Runs on your device with WebGPU. Nothing you ask leaves this browser for the model."
      footer={
        state === 'downloading' ? (
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        ) : state === 'ready' ? (
          <>
            <Button variant="ghost" size="sm" onClick={remove}>
              Remove
            </Button>
            <Button onClick={() => onUse({ provider: 'browser', model: modelId, context, url: '', apiKey: '' })}>Use this model</Button>
          </>
        ) : state === 'error' ? (
          <Button variant="outline" onClick={download}>
            Retry
          </Button>
        ) : (
          <Button disabled={state !== 'idle'} onClick={download}>
            Download model
          </Button>
        )
      }
    >
      <Field label="Context">
        <Choice
          value={String(context)}
          options={CONTEXTS.map((c) => ({ value: String(c), label: `${c / 1024}K tokens · ${gb((c * model.kvKb) / 1024)} more memory` }))}
          onChange={busy ? () => {} : (c) => setContext(Number(c))}
        />
      </Field>
      <dl className="flex flex-col gap-1.5 text-xs/4">
        {[
          ['Model', model.label],
          ['Download', `About ${gb(model.mb)}`],
          ['GPU memory', `About ${gb(model.vramMb + (context * model.kvKb) / 1024)}`],
          ['Runs on', 'WebGPU'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {state === 'checking' && <Status tone="busy">Checking this browser…</Status>}
      {state === 'downloading' && (
        <>
          <Progress value={progress.value * 100} className="h-1.5" />
          <p className="text-xs/4 break-words text-muted-foreground">{progress.text || 'Starting…'}</p>
        </>
      )}
      {state === 'ready' && <Status tone="ok">Ready · cached on this device</Status>}
      {(state === 'unsupported' || state === 'error') && (
        <>
          <Status tone="bad">{state === 'unsupported' ? 'Cannot run here' : 'Could not load the model'}</Status>
          <p className="text-xs/4 break-words text-muted-foreground">{error}</p>
        </>
      )}
    </Setup>
  )
}
