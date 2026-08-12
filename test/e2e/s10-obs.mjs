/**
 * S10 — LA CHAÎNE OBS, de bout en bout, sur la VRAIE application Electron.
 *
 * Deux choses n'étaient couvertes par AUCUN test alors qu'elles tournent à
 * chaque lancement (le serveur local est allumé d'usine) :
 *
 *  1. « est-ce que ça s'affiche en stream ? » — un trait posé sur l'overlay
 *     doit réellement arriver dans la page que le streamer met dans sa source
 *     navigateur. Personne ne le vérifiait ;
 *  2. « est-ce que quelqu'un d'autre peut regarder ? » — le serveur diffuse en
 *     clair, sur la boucle locale, tout ce que le coach annote. Une page web
 *     ouverte dans son navigateur obtenait une origine « null » en trois lignes
 *     (`<iframe sandbox>`) et lisait tout. Le jeton de session ferme cette
 *     porte : ce test-ci est le gardien de cette fermeture. Si quelqu'un
 *     « simplifie » un jour le contrôle d'accès, c'est ici que ça casse.
 *
 *   node test/e2e/s10-obs.mjs
 *
 * Sortie 1 si un test casse. Captures dans test/e2e/captures/s10/.
 * Prérequis : npm run build && npm run build:main
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()

const OUT = join(CAPTURES, 's10')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const R = []
const ok = (n, d) => {
  R.push(['OK', n, d])
  console.log(`  OK   ${n} — ${d}`)
}
const ko = (n, d) => {
  R.push(['KO', n, d])
  console.log(`  KO   ${n} — ${d}`)
}
const dit = (n, c, d) => (c ? ok(n, d) : ko(n, d))
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})

/** Les deux couches (§S11) : on les désigne par leur page, jamais par leur rang. */
let encre = null
for (let i = 0; i < 25 && !encre; i++) {
  await pause(400)
  encre = app.windows().find((w) => w.url().includes('index.html'))
}
if (!encre) {
  console.log('  KO   0.1 couche encre introuvable')
  process.exit(1)
}
await encre.waitForSelector('.stage canvas', { timeout: 20000 })

/* ================================================================== *
 * 1. Le serveur local est bien là, et son adresse est complète
 * ================================================================== */
console.log('\n--- 1. Serveur local ---')
await pause(1200)
const st = await encre.evaluate(() => window.hexa.obsStatus())
dit('1.1 serveur en écoute', st?.running === true, `port ${st?.port} (demandé ${st?.wantedPort})`)
const port = st?.port ?? 0
const jeton = st?.url ? new URL(st.url).searchParams.get('k') : null
dit(
  '1.2 adresse porteuse d’un jeton de session',
  typeof jeton === 'string' && jeton.length >= 24,
  `jeton de ${jeton?.length ?? 0} caractères`,
)

const requete = (chemin, entetes = {}) =>
  new Promise((res) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: chemin,
        headers: { host: `127.0.0.1:${port}`, ...entetes },
      },
      (r) => {
        let body = ''
        r.on('data', (c) => (body += c))
        r.on('end', () => res({ code: r.statusCode, headers: r.headers, body }))
      },
    )
    req.on('error', (e) => res({ code: 0, headers: {}, body: String(e) }))
    req.end()
  })

const page = await requete('/obs.html')
dit('1.3 la page de la source navigateur est servie', page.code === 200, `HTTP ${page.code}`)
dit(
  '1.4 adresse du WebSocket injectée dans la page',
  page.body.includes(`?k=${jeton}`),
  'la page n’a rien à deviner',
)
const nonce = page.body.match(/<script nonce="([^"]+)">/)?.[1] ?? ''
dit(
  '1.5 politique de sécurité stricte sur la page',
  !!nonce && (page.headers['content-security-policy'] ?? '').includes(`'nonce-${nonce}'`),
  `CSP avec nonce (${nonce.slice(0, 8)}…)`,
)

/* ================================================================== *
 * 2. Personne d'autre n'entre
 * ================================================================== */
console.log('\n--- 2. Contrôle d’accès ---')
const rebinding = await requete('/obs.html', { host: 'evil.example' })
dit('2.1 DNS rebinding refusé', rebinding.code === 403, `Host: evil.example → HTTP ${rebinding.code}`)
const siteHttp = await requete('/obs.html', { origin: 'http://evil.example:5206' })
dit('2.2 page refusée à un site web', siteHttp.code === 403, `HTTP ${siteHttp.code}`)
const nullHttp = await requete('/obs.html', { origin: 'null' })
dit('2.3 page refusée à une origine opaque', nullHttp.code === 403, `Origin: null → HTTP ${nullHttp.code}`)

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
function upgrade(chemin, entetes = {}, ecouteMs = 900) {
  return new Promise((res) => {
    const cle = randomBytes(16).toString('base64')
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: chemin,
      headers: {
        host: `127.0.0.1:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': cle,
        'sec-websocket-version': '13',
        ...entetes,
      },
    })
    let fini = false
    const stop = (r) => {
      if (fini) return
      fini = true
      res(r)
    }
    req.on('upgrade', (r, socket) => {
      const attendu = createHash('sha1').update(cle + WS_GUID).digest('base64')
      let octets = 0
      let texte = ''
      socket.on('data', (c) => {
        octets += c.length
        texte += c.toString('utf8')
      })
      setTimeout(() => {
        socket.destroy()
        stop({ code: 101, accept: r.headers['sec-websocket-accept'] === attendu, octets, texte })
      }, ecouteMs)
    })
    req.on('response', (r) => {
      r.resume()
      stop({ code: r.statusCode, accept: false, octets: 0, texte: '' })
    })
    req.on('error', () => stop({ code: 0, accept: false, octets: 0, texte: '' }))
    req.end()
    setTimeout(() => stop({ code: -1, accept: false, octets: 0, texte: '' }), 5000)
  })
}

const sansJeton = await upgrade('/')
dit('2.4 WebSocket sans jeton refusé', sansJeton.code === 403, `HTTP ${sansJeton.code}, ${sansJeton.octets} octets reçus`)
const faux = await upgrade(`/?k=${'0'.repeat(jeton?.length ?? 32)}`)
dit('2.5 WebSocket avec un faux jeton refusé', faux.code === 403, `HTTP ${faux.code}`)
const iframe = await upgrade(`/?k=${jeton}`, { origin: 'null' })
dit(
  '2.6 iframe « sandbox » d’un site hostile refusée',
  iframe.code === 403,
  `Origin: null + jeton → HTTP ${iframe.code}`,
)
const site = await upgrade(`/?k=${jeton}`, { origin: 'http://evil.example:5206' })
dit('2.7 site web hostile refusé', site.code === 403, `HTTP ${site.code}`)

/* ================================================================== *
 * 3. La vue légitime reçoit bien les annotations
 * ================================================================== */
console.log('\n--- 3. « Est-ce que ça s’affiche en stream ? » ---')
await encre.evaluate(() => window.hexa.setPassthrough(false))
await pause(300)
await encre.mouse.move(420, 320)
await encre.mouse.down()
for (let i = 1; i <= 24; i++) {
  await encre.mouse.move(420 + i * 18, 320 + Math.sin(i / 3) * 70, { steps: 1 })
}
await encre.mouse.up()
await pause(900)

const vue = await upgrade(`/?k=${jeton}`, { origin: `http://127.0.0.1:${port}` }, 1200)
dit('3.1 vue OBS légitime acceptée', vue.accept === true, `poignée de main ${vue.code}`)
dit('3.2 état complet diffusé à la connexion', /state:full/.test(vue.texte), `${vue.octets} octets reçus`)

// et maintenant la VRAIE page, dans un vrai Chromium, comme dans OBS
const rendu = await app.evaluate(async ({ BrowserWindow }, url) => {
  const messages = []
  const w = new BrowserWindow({ width: 960, height: 540, show: false })
  w.webContents.on('console-message', (d) => messages.push(`${d.level}: ${d.message}`))
  await w.loadURL(url)
  await new Promise((r) => setTimeout(r, 3000))
  const res = await w.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('canvas')
    let n = -1
    if (c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    }
    return { canvas: document.querySelectorAll('canvas').length, encre: n }
  })()`)
  const png = (await w.webContents.capturePage()).toPNG().toString('base64')
  w.destroy()
  return { ...res, messages, png }
}, st.url)
writeFileSync(join(OUT, '01-vue-obs.png'), Buffer.from(rendu.png, 'base64'))
dit('3.3 la page OBS monte son canevas', rendu.canvas > 0, `${rendu.canvas} canevas`)
dit('3.4 le trait du coach arrive dans la vue OBS', rendu.encre > 500, `${rendu.encre} px peints`)
const violations = rendu.messages.filter((m) => /Content Security Policy|Refused to/i.test(m))
dit('3.5 aucune violation de la politique de sécurité', violations.length === 0, violations[0] ?? 'aucune')

/* ================================================================== *
 * 4. Le jeton ne fuit pas dans le journal
 * ================================================================== */
console.log('\n--- 4. Hygiène ---')
const p = join(USER, 'hexa.log')
const j = existsSync(p) ? readFileSync(p, 'utf8') : ''
dit('4.1 journal écrit', j.length > 0, `${j.length} octets`)
dit(
  '4.2 le jeton de session n’est jamais écrit dans le journal',
  !!jeton && !j.includes(jeton),
  'le fichier que l’utilisateur envoie pour se faire dépanner reste inoffensif',
)

await app.close()
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.filter((r) => r[0] === 'OK').length} OK · ${kos.length} KO`)
if (kos.length) for (const k of kos) console.log('  KO :', k[1], '—', k[2])
process.exit(kos.length ? 1 : 0)
