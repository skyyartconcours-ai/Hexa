/**
 * Hexa — serveur local de la vue OBS (brief §10.2, §2.4).
 *
 * Sert la page obs.html à mettre dans une « Source navigateur » d'OBS, et
 * diffuse l'état d'annotation en JSON typé sur un WebSocket.
 *
 * SÉCURITÉ, non négociable :
 *  - écoute sur 127.0.0.1 UNIQUEMENT. Jamais 0.0.0.0 : ce serait exposer
 *    l'écran du streamer à tout son réseau local, donc à sa box, donc à
 *    n'importe qui de connecté au même wifi. Bonus : une écoute strictement
 *    sur la boucle locale ne déclenche AUCUNE alerte du pare-feu Windows ;
 *  - en-tête Host vérifié : un site distant qui ferait pointer son domaine sur
 *    127.0.0.1 (attaque dite « DNS rebinding ») se fait renvoyer un 403 ;
 *  - JETON DE SESSION obligatoire sur le WebSocket. L'en-tête Origin ne suffit
 *    PAS : une page web quelconque obtient une origine « null » en trois lignes
 *    (`<iframe sandbox="allow-scripts">`), et les WebSockets ignorent CORS.
 *    Sans jeton, n'importe quel onglet ouvert lisait EN DIRECT tout ce que le
 *    streamer annote. Le jeton est tiré au hasard à chaque lancement, n'apparaît
 *    que dans l'adresse affichée à l'utilisateur, et un navigateur ne peut pas
 *    le deviner ni le lire (réponse d'origine croisée = opaque) ;
 *  - en-tête Origin vérifié en plus : une page servie depuis un vrai site est
 *    refusée d'emblée, « null » et « file:// » compris ;
 *  - aucun chemin ne sort du dossier servi (remontées « ../ » bloquées) ;
 *  - le seul message entrant accepté est « donne-moi tout » : rien de ce qui
 *    arrive du réseau ne peut piloter Hexa.
 *
 * ZÉRO DÉPENDANCE : la poignée de main WebSocket (RFC 6455) tient en trente
 * lignes avec `node:crypto`, l'encodage de trame en vingt, le décodage (avec
 * démasquage et fragmentation) en quatre-vingts. Ajouter le paquet `ws` pour ça
 * serait une dépendance de plus à auditer et à embarquer dans l'installateur.
 *
 * PERF : aucune minuterie périodique, aucun « keepalive ». Sur la boucle locale
 * une coupure TCP est vue immédiatement ; au repos ce module ne consomme rien.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import path from 'node:path'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Ports essayés successivement si le port demandé est déjà occupé. */
const PORT_TRIES = 5

/** Une vue OBS n'a rien à nous envoyer de gros : 8 Kio par trame suffisent. */
const MAX_CLIENT_FRAME = 8192

/** Au-delà, la vue ne suit plus (onglet gelé) : on la lâche au lieu d'enfler. */
const MAX_BACKLOG = 4 * 1024 * 1024

/** Hôtes considérés comme locaux (Host et Origin). */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/**
 * JETON DE SESSION — la seule barrière qu'un navigateur ne peut pas franchir.
 *
 * Tiré une fois par lancement de Hexa (jamais écrit sur le disque, jamais
 * journalisé). Le serveur l'exige sur la requête d'upgrade WebSocket, et il le
 * remet lui-même à la page qu'il sert, dans `window.__HEXA_OBS_WS` : c'est ce
 * qui rend le verrou INVISIBLE pour l'utilisateur — l'adresse qu'il colle dans
 * OBS reste `http://127.0.0.1:4787/obs.html`, rien à comprendre, rien à copier.
 * Une page hostile, elle, ne peut ni deviner le jeton (128 bits) ni le lire :
 * la réponse d'une requête d'origine croisée est opaque pour elle, et
 * `frame-ancestors 'none'` lui interdit même d'encadrer la page.
 *
 * Le jeton ne change pas quand le port change : une source OBS déjà configurée
 * continue de fonctionner tant que Hexa n'a pas été relancé.
 */
const SESSION_KEY = randomBytes(16).toString('hex')

/** Le jeton présenté dans l'URL est-il le bon ? (comparaison à temps constant) */
function keyAllowed(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  let given: string | null
  try {
    given = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('k')
  } catch {
    return false
  }
  if (typeof given !== 'string' || given.length !== SESSION_KEY.length) return false
  try {
    return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(SESSION_KEY, 'utf8'))
  } catch {
    return false
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export interface ObsServerOptions {
  /** port souhaité ; si occupé, les 4 suivants sont essayés */
  port: number
  /** dossier contenant obs.html et assets/ (dist/ en production) */
  root: string
  /** notifié quand le nombre de vues connectées change */
  onClients?: (count: number) => void
  /** une vue réclame l'état complet (elle vient de s'ouvrir ou de recharger) */
  onHello?: () => void
  /** journalisation facultative (jamais de donnée sensible) */
  onLog?: (message: string) => void
}

export interface ObsServerStatus {
  running: boolean
  /** port RÉELLEMENT écouté (peut différer si le port demandé était pris) */
  port: number
  /** port demandé dans les réglages */
  wantedPort: number
  clients: number
  url: string
  error?: string
}

interface Client {
  socket: Duplex
  /** octets reçus pas encore décodés */
  buffer: Buffer
  /** opcode du message fragmenté en cours (0 = aucun) */
  fragOp: number
  fragParts: Buffer[]
  fragLen: number
}

let server: Server | null = null
let clients = new Set<Client>()
let current: ObsServerOptions | null = null
let livePort = 0
let lastError: string | undefined

/**
 * Dernier état complet, renvoyé à chaque nouvelle vue qui se connecte.
 *
 * C'est une SUITE de messages, pas un seul : au-delà d'environ 51 000 points,
 * la scène ne tient plus dans un message (le relais IPC la refuserait) et part
 * découpée en `state:full` + `state:more` (voir src/obs/protocol.ts). Ne garder
 * que le premier lot, c'était servir un début de scène à toute vue qui se
 * reconnecte — et un streamer qui coche « éteindre la source quand elle n'est
 * pas visible » se reconnecte à chaque changement de scène.
 *
 * La suite n'existe QUE tant qu'une vue est connectée : le renderer ne publie
 * plus rien quand personne ne regarde (voir src/obs/link.ts). On la relâche donc
 * dès la dernière déconnexion — sur une longue session de tableau blanc, ce sont
 * plusieurs mégaoctets de JSON qui restaient sinon accrochés au processus
 * principal jusqu'à la fermeture d'Hexa.
 */
let lastFullState: string[] = []

/** Sert l'état complet mémorisé à une vue qui arrive. Faux si la socket a lâché. */
function writeFullState(socket: Duplex): boolean {
  for (const frame of lastFullState) {
    try {
      socket.write(encodeText(frame))
    } catch {
      return false
    }
  }
  return true
}

function makeUrl(port: number): string {
  return `http://127.0.0.1:${port}/obs.html?k=${SESSION_KEY}`
}

export function obsServerStatus(): ObsServerStatus {
  return {
    running: server != null,
    port: livePort,
    wantedPort: current?.port ?? 0,
    clients: clients.size,
    url: makeUrl(livePort || (current?.port ?? 0)),
    error: lastError,
  }
}

function log(message: string): void {
  current?.onLog?.(message)
}

/* ------------------------------------------------------------------ *
 * Contrôle d'origine (le pare-feu logique du serveur)
 * ------------------------------------------------------------------ */

/**
 * Vrai si l'en-tête Host désigne bien la machine locale. Bloque le « DNS
 * rebinding » : un site qui résoudrait son domaine vers 127.0.0.1 arriverait
 * ici avec Host: evil.example — et repart en 403.
 */
function hostAllowed(raw: string | undefined): boolean {
  if (!raw) return false
  // [::1]:4787 → on retire le port en partant de la fin
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
  return LOCAL_HOSTS.has(host.toLowerCase())
}

/**
 * Vrai si l'Origin est locale ou absente (une navigation ordinaire n'envoie pas
 * d'Origin : c'est le cas de la source navigateur d'OBS qui ouvre la page).
 *
 * ⚠️ « null » et « file:// » NE SONT PLUS ACCEPTÉS. C'était la faille :
 * `<iframe sandbox="allow-scripts">` donne à n'importe quel site une origine
 * « null », donc un laissez-passer. L'accès aux annotations ne repose de toute
 * façon plus sur ce seul contrôle — voir SESSION_KEY.
 */
function originAllowed(raw: string | undefined): boolean {
  if (!raw) return true
  const origin = raw.trim().toLowerCase()
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return LOCAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Trames WebSocket — encodage (serveur → client)
 * ------------------------------------------------------------------ */

/** Encode une trame texte non masquée (serveur → client). */
function encodeText(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const len = data.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(len, 6)
  }
  header[0] = 0x81 // FIN + opcode texte
  return Buffer.concat([header, data])
}

/** Trame de fermeture propre, avec code RFC 6455. */
function encodeClose(code = 1000): Buffer {
  const body = Buffer.alloc(2)
  body.writeUInt16BE(code, 0)
  return Buffer.concat([Buffer.from([0x88, 0x02]), body])
}

function encodePong(payload: Buffer): Buffer {
  const len = Math.min(payload.length, 125)
  return Buffer.concat([Buffer.from([0x8a, len]), payload.subarray(0, len)])
}

/* ------------------------------------------------------------------ *
 * Trames WebSocket — décodage (client → serveur)
 * ------------------------------------------------------------------ */

function dropClient(c: Client, code?: number): void {
  if (!clients.delete(c)) return
  try {
    if (code != null) c.socket.end(encodeClose(code))
    else c.socket.end()
  } catch {
    /* ignore */
  }
  if (clients.size === 0) lastFullState = []
  current?.onClients?.(clients.size)
}

/**
 * Message texte reçu d'une vue. UN SEUL message est accepté :
 * `{ "t": "obs:hello" }` — « je viens d'ouvrir, envoie-moi tout ».
 * Rien d'autre ne peut piloter Hexa depuis le réseau, par construction.
 */
function handleText(c: Client, text: string): void {
  if (text.length > MAX_CLIENT_FRAME) return
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return
  }
  if (typeof data !== 'object' || data === null) return
  const t = (data as { t?: unknown }).t
  if (t !== 'obs:hello') return
  // état connu tout de suite (une vue ouverte en pleine session est à jour),
  // puis on demande au renderer un état FRAIS : le dernier état complet mémorisé
  // peut dater de plusieurs traits.
  if (lastFullState.length > 0 && !writeFullState(c.socket)) {
    dropClient(c)
    return
  }
  current?.onHello?.()
}

/** Décodage incrémental : démasquage, fragmentation, trames de contrôle. */
function feed(c: Client, chunk: Buffer): void {
  c.buffer = c.buffer.length === 0 ? chunk : Buffer.concat([c.buffer, chunk])

  for (;;) {
    const buf = c.buffer
    if (buf.length < 2) return
    const b0 = buf[0]
    const b1 = buf[1]
    if ((b0 & 0x70) !== 0) {
      // bits réservés : extension non négociée, on coupe court
      dropClient(c, 1002)
      return
    }
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2

    if (len === 126) {
      if (buf.length < 4) return
      len = buf.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      if (buf.length < 10) return
      const hi = buf.readUInt32BE(2)
      const lo = buf.readUInt32BE(6)
      if (hi !== 0) {
        dropClient(c, 1009)
        return
      }
      len = lo
      offset = 10
    }

    // Le client DOIT masquer (RFC 6455 §5.1), et rester petit.
    if (!masked || len > MAX_CLIENT_FRAME) {
      dropClient(c, masked ? 1009 : 1002)
      return
    }
    if (buf.length < offset + 4 + len) return
    const mask = buf.subarray(offset, offset + 4)
    const payload = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) payload[i] = buf[offset + 4 + i] ^ mask[i & 3]
    c.buffer = buf.subarray(offset + 4 + len)

    // --- trames de contrôle : toujours complètes, toujours courtes ---
    if (opcode >= 0x8) {
      if (!fin || len > 125) {
        dropClient(c, 1002)
        return
      }
      if (opcode === 0x8) {
        dropClient(c, 1000)
        return
      }
      if (opcode === 0x9) {
        try {
          c.socket.write(encodePong(payload))
        } catch {
          dropClient(c)
          return
        }
      }
      // 0xa (pong) : rien à faire, on n'envoie jamais de ping
      continue
    }

    // --- trames de données ---
    if (opcode === 0x2) {
      // binaire : la vue n'en envoie jamais
      dropClient(c, 1003)
      return
    }
    if (opcode === 0x1 || opcode === 0x0) {
      const op = opcode === 0x0 ? c.fragOp : opcode
      if (opcode === 0x0 && op === 0) {
        dropClient(c, 1002)
        return
      }
      if (fin && c.fragParts.length === 0) {
        if (op === 0x1) handleText(c, payload.toString('utf8'))
        continue
      }
      c.fragOp = op
      c.fragParts.push(payload)
      c.fragLen += len
      if (c.fragLen > MAX_CLIENT_FRAME) {
        dropClient(c, 1009)
        return
      }
      if (fin) {
        const whole = Buffer.concat(c.fragParts)
        c.fragParts = []
        c.fragLen = 0
        c.fragOp = 0
        if (op === 0x1) handleText(c, whole.toString('utf8'))
      }
      continue
    }
    dropClient(c, 1002)
    return
  }
}

/* ------------------------------------------------------------------ *
 * Fichiers statiques
 * ------------------------------------------------------------------ */

/** Page de secours : dist/obs.html absent (développement, build oublié). */
function notBuiltPage(port: number): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>Hexa · vue OBS</title>` +
    `<body style="margin:0;font:14px/1.6 system-ui;color:#e8ecf5;background:#0b0f1c;padding:32px">` +
    `<h1 style="font-size:18px">Vue OBS d'Hexa — page non construite</h1>` +
    `<p>Le serveur tourne bien sur <b>127.0.0.1:${port}</b>, mais <code>dist/obs.html</code> n'existe pas.</p>` +
    `<p>Lance <code>npm run build</code> une fois, ou pointe la source navigateur sur le serveur de développement :<br>` +
    `<code>http://localhost:5173/obs.html?ws=ws://127.0.0.1:${port}/?k=${SESSION_KEY}</code></p></body>`
  )
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, port: number): void {
  const raw = (req.url ?? '/').split('?')[0]
  let rel: string
  try {
    rel = raw === '/' || raw === '' ? '/obs.html' : decodeURIComponent(raw)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('requête invalide')
    return
  }
  const base = path.resolve(root)
  const target = path.resolve(base, '.' + path.posix.normalize(rel))
  // Confinement : on ne sert JAMAIS un fichier hors du dossier prévu.
  // `path.relative` est la bonne comparaison — un simple startsWith laisserait
  // passer un dossier voisin dont le nom commence pareil.
  const inside = target === base || !path.relative(base, target).startsWith('..')
  if (!inside || path.isAbsolute(path.relative(base, target))) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('interdit')
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    // Cas courant en développement : dist/ n'existe pas encore. On explique,
    // au lieu d'un 404 sec devant lequel personne ne sait quoi faire.
    if (target.endsWith('obs.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(notBuiltPage(port))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('introuvable')
    return
  }
  const ext = path.extname(target).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const common = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }

  if (ext === '.html') {
    // On injecte l'adresse du WebSocket, JETON COMPRIS : la page n'a rien à
    // deviner, et le jeton ne traverse jamais autre chose que la boucle locale.
    let html = readFileSync(target, 'utf8')
    // Ce petit script est le SEUL script en ligne de la page : il porte un nonce
    // tiré à chaque réponse, ce qui permet une politique de sécurité stricte
    // sans « unsafe-inline » (une injection future n'aurait pas le nonce).
    const nonce = randomBytes(16).toString('base64')
    const ws = `ws://127.0.0.1:${port}/?k=${SESSION_KEY}`
    const tag = `<script nonce="${nonce}">window.__HEXA_OBS_WS=${JSON.stringify(ws)}</script>`
    html = html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html
    res.writeHead(200, {
      'content-type': type,
      ...common,
      // Défense en profondeur : cette page ne charge QUE ses propres fichiers,
      // ne parle qu'au serveur local, et ne peut pas être encadrée par un site.
      'content-security-policy':
        `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; ` +
        `img-src 'self' data: blob:; font-src 'self' data:; ` +
        `connect-src ws://127.0.0.1:* ws://localhost:*; ` +
        `base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'x-frame-options': 'DENY',
    })
    res.end(html)
    return
  }

  res.writeHead(200, { 'content-type': type, ...common })
  createReadStream(target).pipe(res)
}

/* ------------------------------------------------------------------ *
 * Cycle de vie
 * ------------------------------------------------------------------ */

/** Écoute sur 127.0.0.1, en essayant les ports suivants si le premier est pris. */
function listenWithFallback(srv: Server, wanted: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryPort = (): void => {
      const port = wanted + attempt
      const onError = (err: NodeJS.ErrnoException): void => {
        srv.removeListener('listening', onOk)
        if (err.code === 'EADDRINUSE' && attempt + 1 < PORT_TRIES && port + 1 < 65536) {
          attempt++
          log(`port ${port} occupé, tentative sur ${port + 1}`)
          setImmediate(tryPort)
          return
        }
        reject(err)
      }
      const onOk = (): void => {
        srv.removeListener('error', onError)
        resolve(port)
      }
      srv.once('error', onError)
      srv.once('listening', onOk)
      // 127.0.0.1 UNIQUEMENT — jamais 0.0.0.0.
      srv.listen(port, '127.0.0.1')
    }
    tryPort()
  })
}

/**
 * File d'attente des démarrages.
 *
 * Sur deux écrans, Hexa ouvre deux pages qui demandent TOUTES LES DEUX le
 * serveur, dans la même milliseconde. Sans cette file, la seconde demande
 * arriverait pendant que la première attend encore son `listen` : elle croirait
 * qu'aucun serveur n'existe, en lancerait un deuxième, qui trouverait le port
 * pris… par son jumeau, et se replierait sur 4788. Deux serveurs, une adresse
 * fausse affichée à l'utilisateur. On sérialise donc, tout simplement.
 */
let queue: Promise<unknown> = Promise.resolve()

export function startObsServer(opts: ObsServerOptions): Promise<ObsServerStatus> {
  const next = queue.then(() => startNow(opts))
  queue = next.catch(() => undefined)
  return next
}

async function startNow(opts: ObsServerOptions): Promise<ObsServerStatus> {
  if (server && current && current.port === opts.port) {
    // même port : on garde le serveur et les vues connectées, on met juste les
    // rappels à jour (le renderer a pu être rechargé)
    current = { ...opts }
    return obsServerStatus()
  }
  stopObsServer()
  current = { ...opts }
  lastError = undefined

  const srv = createServer((req, res) => {
    try {
      if (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Hexa : accès local uniquement')
        return
      }
      if ((req.url ?? '').startsWith('/health')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ app: 'hexa', port: livePort, clients: clients.size }))
        return
      }
      serveStatic(req, res, opts.root, livePort || opts.port)
    } catch (err) {
      try {
        res.writeHead(500).end('erreur')
      } catch {
        /* ignore */
      }
      log(`erreur HTTP : ${String(err)}`)
    }
  })

  srv.on('upgrade', (req, socket: Duplex) => {
    const key = req.headers['sec-websocket-key']
    // LE contrôle qui compte : sans le jeton de session, personne n'écoute ce
    // que le streamer annote — pas même une page qui se présenterait avec une
    // origine « null ». Le contrôle d'hôte et d'origine reste en première ligne.
    if (
      typeof key !== 'string' ||
      !hostAllowed(req.headers.host) ||
      !originAllowed(req.headers.origin) ||
      !keyAllowed(req.url)
    ) {
      log(
        `connexion refusée (origine « ${req.headers.origin ?? 'absente'} », ` +
          `jeton ${keyAllowed(req.url) ? 'valide' : 'absent ou faux'})`,
      )
      try {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      } catch {
        /* ignore */
      }
      return
    }
    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    // Le flux d'un upgrade est toujours une socket TCP, mais Node le déclare
    // en simple Duplex : on demande donc l'option sans l'exiger.
    const tcp = socket as Duplex & { setNoDelay?: (on: boolean) => void }
    tcp.setNoDelay?.(true)

    const client: Client = { socket, buffer: Buffer.alloc(0), fragOp: 0, fragParts: [], fragLen: 0 }
    clients.add(client)
    current?.onClients?.(clients.size)
    log(`vue OBS connectée (${clients.size})`)

    const drop = (): void => {
      if (clients.delete(client)) {
        if (clients.size === 0) lastFullState = []
        current?.onClients?.(clients.size)
        log(`vue OBS déconnectée (${clients.size})`)
      }
    }
    socket.on('data', (chunk: Buffer) => {
      try {
        feed(client, chunk)
      } catch {
        dropClient(client, 1011)
      }
    })
    socket.on('close', drop)
    socket.on('error', drop)
    socket.on('end', drop)

    // État complet immédiat : une vue qui s'ouvre en pleine session est à jour
    // sans attendre le prochain trait. La vue redemande ensuite un état FRAIS
    // avec « obs:hello » (voir handleText).
    if (lastFullState.length > 0) {
      if (!writeFullState(socket)) drop()
    } else {
      // Rien en réserve — c'est le cas NORMAL de la première connexion, puisque
      // le renderer se tait tant que personne ne regarde. On réclame l'état
      // tout de suite, sans attendre le « obs:hello » de la vue : une source
      // navigateur mal réglée (ou un simple client de diagnostic) reçoit ainsi
      // les annotations déjà à l'écran.
      current?.onHello?.()
    }
  })

  try {
    livePort = await listenWithFallback(srv, opts.port)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    lastError =
      e.code === 'EADDRINUSE'
        ? `les ports ${opts.port} à ${opts.port + PORT_TRIES - 1} sont tous occupés`
        : `démarrage impossible (${e.message})`
    livePort = 0
    server = null
    log(`serveur OBS : ${lastError}`)
    try {
      srv.close()
    } catch {
      /* ignore */
    }
    return obsServerStatus()
  }

  // Erreurs survenant APRÈS l'écoute (rare, mais on ne meurt pas en silence).
  srv.on('error', (err: NodeJS.ErrnoException) => {
    lastError = err.message
    log(`serveur OBS : ${err.message}`)
  })

  server = srv
  // Le jeton n'est JAMAIS écrit dans le journal : ce fichier, l'utilisateur
  // l'envoie pour se faire dépanner.
  log(`serveur OBS en écoute sur http://127.0.0.1:${livePort}/obs.html`)
  return obsServerStatus()
}

export function stopObsServer(): void {
  for (const c of [...clients]) {
    try {
      c.socket.end(encodeClose(1001))
    } catch {
      /* ignore */
    }
  }
  clients = new Set()
  lastFullState = []
  if (server) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }
  livePort = 0
  current = null
}

/** Diffuse un message déjà sérialisé à toutes les vues connectées. */
export function broadcastObs(payload: string): void {
  // Un `state:full` ouvre une nouvelle suite, chaque `state:more` la complète.
  // Un `state:more` orphelin (la vue s'est connectée au milieu d'un envoi) est
  // ignoré : elle recevra de toute façon un état frais grâce à son « hello ».
  if (payload.includes('"state:full"')) lastFullState = [payload]
  else if (payload.includes('"state:more"') && lastFullState.length > 0) {
    lastFullState.push(payload)
  }
  if (clients.size === 0) return
  const frame = encodeText(payload)
  for (const c of [...clients]) {
    // Une vue qui ne consomme plus (onglet gelé, OBS en train de mourir) ne doit
    // pas faire enfler la mémoire du processus principal : on la lâche.
    if (c.socket.writableLength > MAX_BACKLOG) {
      log('vue OBS trop lente, déconnectée')
      dropClient(c, 1013)
      continue
    }
    try {
      c.socket.write(frame)
    } catch {
      dropClient(c)
    }
  }
}
