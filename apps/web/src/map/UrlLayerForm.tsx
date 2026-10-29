import { useState } from 'react'
import { guessFormat, type UrlFormat } from '@ttx/plugins'

export interface UrlLayerArgs {
  url: string
  format: UrlFormat
  min?: number
  max?: number
  attribution?: string
  title?: string
}

/** "Add from a URL" in a map's Options panel: the format comes from the URL's extension, and a COG asks for its value range. */
export function UrlLayerForm({ onAdd }: { onAdd(args: UrlLayerArgs): void }) {
  const [url, setUrl] = useState('')
  const [min, setMin] = useState('0')
  const [max, setMax] = useState('100')
  const [attribution, setAttribution] = useState('')
  const format = guessFormat(url.trim())
  const range = format === 'cog' ? { min: Number(min), max: Number(max) } : undefined
  const valid = /^https?:\/\//.test(url.trim()) && !!format && (!range || (Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max))

  return (
    <form
      className="ttx-location"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || !format) return
        onAdd({ url: url.trim(), format, ...range, ...(attribution.trim() && { attribution: attribution.trim() }) })
        setUrl('')
      }}
    >
      <input aria-label="Layer URL" placeholder="https://… (.geojson, .parquet, .zip, .tif, {z}/{x}/{y})" value={url} onChange={(e) => setUrl(e.target.value)} />
      {url.trim() && !format && <p className="ttx-options__empty">The URL must end in .geojson, .parquet, .zip or .tif, or have {'{z}/{x}/{y}'} for tiles.</p>}
      {range && (
        <div className="ttx-location__row">
          <input aria-label="Lowest value drawn" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          <span>to</span>
          <input aria-label="Value of the last color" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
      )}
      <input aria-label="Attribution" placeholder="Attribution (optional)" value={attribution} onChange={(e) => setAttribution(e.target.value)} />
      <button type="submit" disabled={!valid}>
        Add layer
      </button>
      <p className="ttx-options__empty">Everyone's browser reads it: the server must allow CORS.</p>
    </form>
  )
}
