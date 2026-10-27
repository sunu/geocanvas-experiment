/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** tldraw license key, read at build time. Needed on any host other than localhost. */
  readonly VITE_TLDRAW_LICENSE_KEY?: string
}
