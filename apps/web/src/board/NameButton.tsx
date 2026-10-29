import { useState } from 'react'
import type { Actor } from '@ttx/core'
import { Input } from '@/components/ui/input'
import { MAX_NAME, rename, usePersonName } from './person'
import type { Awareness } from './presence'

/** This person's name, as others see it on their cursor and chat messages. Click to change it. */
export function NameButton({ actor, awareness }: { actor: Actor; awareness: Awareness }) {
  const name = usePersonName(actor, awareness)
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button type="button" className="rounded-md px-1 text-sm font-medium text-foreground hover:bg-accent" title="Your name, as others see it. Click to change it" onClick={() => setEditing(true)}>
        {name}
      </button>
    )
  }
  return (
    <Input
      aria-label="Your name"
      defaultValue={name}
      maxLength={MAX_NAME}
      autoFocus
      className="h-8 w-36 text-sm font-medium"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        rename(actor, awareness, e.currentTarget.value)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          // Keep the canvas from also clearing the selection.
          e.stopPropagation()
          e.currentTarget.value = name
          e.currentTarget.blur()
        }
      }}
    />
  )
}
