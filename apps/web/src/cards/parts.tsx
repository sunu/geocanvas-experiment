import { useState, type FormEvent } from 'react'

/**
 * For a card's buttons and links: a press on one is for it, not a select or drag of the card.
 */
export const control = {
  onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
  onDoubleClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
}

/**
 * The field a new card made from a link asks for it with: paste one and it is taken at once. `accepts` is checked
 * here for a short message (`invalid`); the op checks again. `onSubmit` resolves to the reason the card refused it.
 */
export function LinkField({ label, placeholder, hint, invalid, accepts, onSubmit }: {
  label: string
  placeholder: string
  hint: string
  invalid: string
  accepts(text: string): boolean
  onSubmit(url: string): Promise<string | undefined>
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const submit = async (url: string) => setError(accepts(url) ? await onSubmit(url) : invalid)
  return (
    <form
      className="ttx-card__form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void submit(text)
      }}
    >
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (!accepts(pasted)) return
          e.preventDefault()
          setText(pasted)
          void submit(pasted)
        }}
      />
      {error && <div className="ttx-card__error">{error}</div>}
      <div className="ttx-card__note">{hint}</div>
    </form>
  )
}
