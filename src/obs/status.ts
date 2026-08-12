/**
 * Hexa — état vivant du serveur de la vue OBS (§10.2).
 *
 * Le processus principal est le seul à savoir la vérité : sur quel port il
 * écoute VRAIMENT (le port demandé pouvait être occupé), combien de sources
 * navigateur sont connectées, et si quelque chose a échoué. Ce module range
 * cette vérité à un seul endroit, et le panneau de réglages s'y abonne.
 *
 * Minuscule exprès : pas de store global de plus, pas de dépendance, un
 * abonnement compatible `useSyncExternalStore`. Aucune minuterie : l'état ne
 * change que lorsque le processus principal le pousse.
 */

export interface ObsServerInfo {
  /** le serveur écoute réellement */
  running: boolean
  /** port réellement écouté (0 si arrêté) */
  port: number
  /** port demandé dans les réglages */
  wantedPort: number
  /** nombre de sources navigateur connectées */
  clients: number
  /** message d'erreur lisible, s'il y en a une */
  error?: string
}

const EMPTY: ObsServerInfo = { running: false, port: 0, wantedPort: 0, clients: 0 }

let info: ObsServerInfo = EMPTY
const listeners = new Set<() => void>()

/** Instantané stable : la même référence tant que rien n'a changé. */
export function obsServerInfo(): ObsServerInfo {
  return info
}

export function subscribeObsServer(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function same(a: ObsServerInfo, b: ObsServerInfo): boolean {
  return (
    a.running === b.running &&
    a.port === b.port &&
    a.wantedPort === b.wantedPort &&
    a.clients === b.clients &&
    a.error === b.error
  )
}

function emit(next: ObsServerInfo): void {
  if (same(info, next)) return
  info = next
  for (const fn of listeners) fn()
}

/** Applique un état venu du processus principal. Tout est revalidé ici. */
export function setObsServerInfo(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return
  const r = raw as Record<string, unknown>
  const port = typeof r.port === 'number' && r.port > 0 && r.port < 65536 ? Math.round(r.port) : 0
  const wanted =
    typeof r.wantedPort === 'number' && r.wantedPort > 0 && r.wantedPort < 65536
      ? Math.round(r.wantedPort)
      : port
  emit({
    running: r.running === true,
    port,
    wantedPort: wanted,
    clients: typeof r.clients === 'number' && r.clients >= 0 ? Math.round(r.clients) : 0,
    error: typeof r.error === 'string' && r.error ? r.error : undefined,
  })
}

/** Met à jour le seul nombre de vues (canal léger poussé à chaque connexion). */
export function setObsClients(count: number): void {
  if (!Number.isFinite(count)) return
  emit({ ...info, clients: Math.max(0, Math.round(count)) })
}

/** Remet à zéro (serveur arrêté, application en fermeture). */
export function resetObsServerInfo(): void {
  emit(EMPTY)
}

/**
 * L'adresse EXACTE à coller dans la source navigateur d'OBS.
 * `fallbackPort` sert avant la première réponse du processus principal, pour ne
 * jamais afficher une adresse vide à l'utilisateur.
 */
export function obsBrowserUrl(fallbackPort: number): string {
  const port = info.port || fallbackPort
  return `http://127.0.0.1:${port}/obs.html`
}
