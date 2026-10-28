import { useState } from 'react'
import { CheckIcon, LinkIcon } from '@phosphor-icons/react'

/** How long "Copied" shows after copying the link. */
const COPIED_MS = 1500

/** Copies a file's link. Without clipboard access (denied, or an insecure origin), shows the link to copy by hand. */
export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      prompt('Link to this file', link)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <button type="button" onClick={copy} title="Copy link" aria-label="Copy link">
      {copied ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
    </button>
  )
}
