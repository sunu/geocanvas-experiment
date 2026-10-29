import { OPENEO_BASE_URL } from '@ttx/plugins'

export interface OpenEOCredentials {
  OPENEO_BASE_URL?: string
  OPENEO_USER?: string
  OPENEO_PASS?: string
}

/** EOPF openEO with the Worker's Copernicus login: the service manager and the agent's preview tool share one token. */
export class OpenEOClient {
  readonly baseUrl: string
  private readonly credentials: OpenEOCredentials
  private token?: { value: string; expiresAt: number }

  constructor(credentials: OpenEOCredentials) {
    this.credentials = credentials
    this.baseUrl = (credentials.OPENEO_BASE_URL ?? OPENEO_BASE_URL).replace(/\/$/, '')
  }

  get hasCredentials() {
    return !!this.credentials.OPENEO_USER && !!this.credentials.OPENEO_PASS
  }

  async request(path: string, init: RequestInit = {}) {
    const token = await this.accessToken()
    const url = path.startsWith('http') ? new URL(path) : new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`)
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('EOPF returned a service URL on an unexpected host')
    // openEO's token format is "oidc/<provider id>/<token>"; EOPF lists one provider, "oidc" (its /credentials/oidc).
    return fetch(url, { ...init, headers: { authorization: `Bearer oidc/oidc/${token}`, ...init.headers } })
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    const username = this.credentials.OPENEO_USER
    const password = this.credentials.OPENEO_PASS
    if (!username || !password) throw new Error('Set OPENEO_USER and OPENEO_PASS in apps/worker/.dev.vars')
    const response = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'cdse-public', grant_type: 'password', username, password }),
    })
    if (!response.ok) throw new Error(`CDSE login failed (${response.status}): ${await response.text()}`)
    const token = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!token.access_token) throw new Error('CDSE did not return an access token')
    this.token = { value: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 300) * 1000 }
    return token.access_token
  }
}
