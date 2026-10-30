/**
 * Which layout a board opens in: the canvas, or the phone's (mobile/MobileApp.tsx). Phone-sized screens get the
 * phone's; `?layout=phone` or `?layout=desktop` overrides it in this browser from then on, and `?layout=auto` goes
 * back to the screen's size.
 */
export type Layout = 'phone' | 'desktop'

const KEY = 'ttx/layout'
/** Narrower than this (CSS px) is a phone, in either orientation's short side. */
const PHONE_MAX_WIDTH = 640

export function chooseLayout(search = location.search, store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): Layout {
  const asked = new URLSearchParams(search).get('layout')
  try {
    if (asked === 'phone' || asked === 'desktop') store?.setItem(KEY, asked)
    else if (asked === 'auto') store?.removeItem(KEY)
    const saved = store?.getItem(KEY)
    if (saved === 'phone' || saved === 'desktop') return saved
  } catch {
    // Blocked storage: go by the screen.
  }
  return matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches ? 'phone' : 'desktop'
}

/** Open this board in the other layout. */
export function switchLayout(to: Layout) {
  const url = new URL(location.href)
  url.searchParams.set('layout', to)
  location.assign(url)
}
