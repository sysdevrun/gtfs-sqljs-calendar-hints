// CORS proxy hébergé par SysDevRun : la plupart des serveurs GTFS n'envoient
// pas d'en-têtes CORS, on préfixe donc les URLs distantes.
const PROXY_BASE = 'https://gtfs-proxy.sys-dev-run.re/proxy/'

export function proxyUrl(url: string): string {
  if (url.startsWith('./') || url.startsWith('/') || url.startsWith('../')) return url
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return PROXY_BASE + parsed.host + parsed.pathname + parsed.search
    }
    return url
  } catch {
    return url
  }
}
