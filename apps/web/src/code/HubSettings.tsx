import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { connectHub, disconnectHub, useHub } from './hub'

/**
 * This person's JupyterHub login, in the JupyterHub tab of Settings (plans/plan-021.md). Code cells run on it, as
 * this person. The token comes from the hub's Token page and stays in this browser.
 */
export function HubSettings() {
  const hub = useHub()
  const [url, setUrl] = useState(hub.login?.url ?? '')
  const [token, setToken] = useState('')
  return hub.status === 'ready' ? (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Code cells run as <strong>{hub.user}</strong> on {hub.login?.url}.
      </p>
      <Button variant="outline" size="sm" onClick={disconnectHub}>
        Disconnect
      </Button>
    </div>
  ) : (
    <form
      className="space-y-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        void connectHub(url, token)
        setToken('')
      }}
    >
      <p className="text-muted-foreground">Code cells run on your own hub server. Make a token on the hub's Token page; it stays in this browser.</p>
      <Input placeholder="https://hub.example.org" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Hub URL" required />
      <Input placeholder="Token" type="password" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Token" required autoComplete="off" />
      {hub.status === 'error' && <p className="text-destructive">{hub.error}</p>}
      <Button type="submit" size="sm" disabled={hub.status === 'checking'}>
        {hub.status === 'checking' ? 'Checking…' : 'Connect'}
      </Button>
    </form>
  )
}

/** The hub login's state as a dot, on the Settings button: none until someone connects one. */
export function HubStatusDot() {
  const hub = useHub()
  if (hub.status === 'none') return null
  const label = hub.status === 'ready' ? `JupyterHub: connected as ${hub.user}` : hub.status === 'error' ? `JupyterHub: ${hub.error}` : 'JupyterHub: checking'
  return (
    <span
      title={label}
      aria-label={label}
      className={cn('absolute right-1 bottom-1 size-1.5 rounded-full', hub.status === 'ready' ? 'bg-green-500' : hub.status === 'error' ? 'bg-red-500' : 'bg-amber-500')}
    />
  )
}
