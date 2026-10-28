import { useState } from 'react'
import { UserIcon } from '@phosphor-icons/react'
import type { Actor } from '@ttx/core'
import { MAX_NAME, rename, usePersonName } from './person'
import type { Awareness } from './presence'

/** This person's name, as others see it on their cursor and chat messages. Click to change it. */
export function NameButton({ actor, awareness }: { actor: Actor; awareness: Awareness }) {
  const name = usePersonName(actor, awareness)
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button title="Your name, as others see it. Click to change it" onClick={() => setEditing(true)}>
        <UserIcon size={16} color={actor.color} />
        {name}
      </button>
    )
  }
  return (
    <label className="ttx-toolbar__name">
      <UserIcon size={16} color={actor.color} />
      <input
        aria-label="Your name"
        defaultValue={name}
        maxLength={MAX_NAME}
        autoFocus
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
    </label>
  )
}
