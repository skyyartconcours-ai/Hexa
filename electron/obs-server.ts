/**
 * Hexa — serveur local de la vue OBS (brief §10.2, §2.4).
 *
 * Sert la page obs.html à mettre dans une browser source, et diffuse l'état
 * d'annotation en JSON typé sur un WebSocket.
 *
 * SÉCURITÉ, non négociable :
 *  - écoute sur 127.0.0.1 UNIQUEMENT. Jamais 0.0.0.0 : ce serait exposer
 *    l'écran du streamer à tout son réseau local, donc à sa box, donc à
 *    n'importe qui de connecté au même wifi ;
 *  - aucune écriture, aucune commande, aucun chemin qui sorte du dossier servi
 *    (protection contre les remontées ../) ;
 *  - le WebSocket est diffusion seule : ce que le client envoie est ignoré.
 *
 * ZÉRO DÉPENDANCE : la poignée de main WebSocket (RFC 6455) tient en trente
 * lignes avec `node:crypto`, et l'encodage de trame texte en vingt. Ajouter le
 * paquet `ws` pour ça serait une dépendance de plus à auditer et à embarquer
 * dans l'installeur, pour rien.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import path from 'node:path'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

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
  port: number
  /** dossier contenant obs.html et assets/ (dist/ en production) */
  root: string
  /** notifié quand le nombre de vues connectées change */
  onClients?: (count: number) => void
}

export interface ObsServerStatus {
  running: boolean
  port: number
  clients: number
  url: string
  error?: string
}

let server: Server | null = null
let sockets = new Set<Duplex>()
let current: ObsServerOptions | null = null
let lastError: string | undefined

/** Dernier état complet, renvoyé à chaque nouvelle vue qui se connecte. */
let lastFullState: string | null = null

function url(port: number): string {
  return `http://127.0.0.1:${port}/obs.html`
}

export function obsServerStatus(): ObsServerStatus {
  return {
    running: server != null,
    port: current?.port ?? 0,
    clients: sockets.size,
    url: url(current?.port ?? 0),
    error: lastError,
  }
}

/* ------------------------------------------------------------------ *
 * Trames WebSocket
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

/** Trame de fermeture propre. */
function encodeClose(): Buffer {
  return Buffer.from([0x88, 0x00])
}

/**
 * Lecture minimale des trames entrantes : on ne fait qu'entretenir la
 * connexion (pong, close). Le contenu client est volontairement ignoré.
 */
function readIncoming(socket: Duplex, chunk: Buffer): void {
  if (chunk.length < 2) return
  const opcode = chunk[0] & 0x0f
  if (opcode === 0x8) {
    // close
    try {
      socket.end(encodeClose())
    } catch {
      /* ignore */
    }
    return
  }
  if (opcode === 0x9) {
    // ping → pong (même charge utile, ici vide : suffisant en pratique)
    try {
      socket.write(Buffer.from([0x8a, 0x00]))
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Fichiers statiques
 * ------------------------------------------------------------------ */

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, port: number): void {
  const raw = (req.url ?? '/').split('?')[0]
  const rel = raw === '/' || raw === '' ? '/obs.html' : decodeURIComponent(raw)
  const target = path.resolve(root, '.' + path.posix.normalize(rel))
  // Confinement : on ne sert JAMAIS un fichier hors du dossier prévu.
  if (!target.startsWith(path.resolve(root))) {
    res.writeHead(403).end('interdit')
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    // Cas courant en développement : dist/ n'existe pas encore. On explique,
    // au lieu d'un 404 sec devant lequel personne ne sait quoi faire.
    if (target.endsWith('obs.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Hexa · vue OBS</title>` +
          `<body style="margin:0;font:14px/1.6 system-ui;color:#e8ecf5;background:#0b0f1c;padding:32px">` +
          `<h1 style="font-size:18px">Vue OBS d'Hexa — page non construite</h1>` +
          `<p>Le serveur tourne bien sur <b>127.0.0.1:${port}</b>, mais <code>dist/obs.html</code> n'existe pas.</p>` +
          `<p>Lance <code>npm run build</code> une fois, ou pointe la browser source sur le serveur de dev :<br>` +
          `<code>http://localhost:5173/obs.html?ws=ws://127.0.0.1:${port}</code></p></body>`,
      )
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('introuvable')
    return
  }
  const ext = path.extname(target).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'

  if (ext === '.html') {
    // On injecte l'adresse du WebSocket : la page n'a rien à deviner.
    let html = readFileSync(target, 'utf8')
    const tag = `<script>window.__HEXA_OBS_WS=${JSON.stringify(`ws://127.0.0.1:${port}`)}</script>`
    html = html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      // La page ne doit jamais être embarquée ailleurs que dans OBS/local.
      'x-content-type-options': 'nosniff',
    })
    res.end(html)
    return
  }

  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  createReadStream(target).pipe(res)
}

/* ------------------------------------------------------------------ *
 * Cycle de vie
 * ------------------------------------------------------------------ */

export function startObsServer(opts: ObsServerOptions): ObsServerStatus {
  if (server && current && current.port === opts.port) {
    current = { ...opts }
    return obsServerStatus()
  }
  stopObsServer()
  current = { ...opts }
  lastError = undefined

  const srv = createServer((req, res) => {
    try {
      if ((req.url ?? '').startsWith('/health')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ app: 'hexa', clients: sockets.size }))
        return
      }
      serveStatic(req, res, opts.root, opts.port)
    } catch {
      try {
        res.writeHead(500).end('erreur')
      } catch {
        /* ignore */
      }
    }
  })

  srv.on('upgrade', (req, socket: Duplex) => {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
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
    socket.setNoDelay(true)
    sockets.add(socket)
    current?.onClients?.(sockets.size)

    const drop = () => {
      if (sockets.delete(socket)) current?.onClients?.(sockets.size)
    }
    socket.on('data', (chunk: Buffer) => readIncoming(socket, chunk))
    socket.on('close', drop)
    socket.on('error', drop)
    socket.on('end', drop)

    // état complet immédiat : une vue qui s'ouvre en pleine session est à jour
    if (lastFullState) {
      try {
        socket.write(encodeText(lastFullState))
      } catch {
        drop()
      }
    }
  })

  srv.on('error', (err: NodeJS.ErrnoException) => {
    lastError = err.code === 'EADDRINUSE' ? `port ${opts.port} déjà occupé` : String(err.message)
    server = null
  })

  // 127.0.0.1 UNIQUEMENT — jamais 0.0.0.0.
  srv.listen(opts.port, '127.0.0.1')
  server = srv
  return obsServerStatus()
}

export function stopObsServer(): void {
  for (const s of sockets) {
    try {
      s.end(encodeClose())
    } catch {
      /* ignore */
    }
  }
  sockets = new Set()
  lastFullState = null
  if (server) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }
  current = null
}

/** Diffuse un message déjà sérialisé à toutes les vues connectées. */
export function broadcastObs(payload: string): void {
  if (payload.includes('"state:full"')) lastFullState = payload
  if (sockets.size === 0) return
  const frame = encodeText(payload)
  for (const s of sockets) {
    try {
      s.write(frame)
    } catch {
      sockets.delete(s)
    }
  }
}
