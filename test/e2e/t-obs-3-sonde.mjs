#!/usr/bin/env node
/**
 * T-OBS-3 — « ÇA PREND COMBIEN DE RESSOURCES ? » : LA SONDE ET LE TÉMOIN.
 *
 * Sur la vraie application, deux fenêtres par écran :
 *   1. l'ASSISTANT OBS des réglages : le témoin passe TOUT SEUL de « aucune
 *      source » à « 1 source connectée » quand une vue se branche, et revient ;
 *   2. le témoin « Coût actuel » se remplit panneau ouvert (processeur,
 *      mémoire, images/s, surface), avec 0 image/s pour la couche encre au
 *      repos, et NE COÛTE RIEN panneau fermé : plus une seule lecture des
 *      métriques dans le processus principal ;
 *   3. la sonde de 30 s : lancée, elle écrit un JSON et un résumé en français
 *      qui CONCLUT, ouvre le dossier, et ne laisse derrière elle ni minuterie,
 *      ni méthode de fenêtre enrobée, ni lecture périodique. Pendant la
 *      mesure, un trait est posé : le rapport doit le voir (images > 0 sur la
 *      couche encre, annotations vivantes = 1).
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-3-sonde.mjs
 *
 * Durée : ~70 s (la sonde dure 30 s pour de vrai, plus 3,5 s de bandeau).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 't-obs-3')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const R = []
const dit = (n, c, d) => {
  R.push([c ? 'OK' : 'KO', n, d])
  console.log(`  ${c ? 'OK ' : 'KO '}  ${n} — ${d}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})

/* --- espions dans le principal : lectures de métriques, ouverture du dossier -- */
await app.evaluate(({ app: electronApp, shell }) => {
  const g = globalThis
  g.__s = { metrics: 0, dossiers: [] }
  const orig = electronApp.getAppMetrics.bind(electronApp)
  electronApp.getAppMetrics = () => {
    g.__s.metrics++
    return orig()
  }
  // Sous Xvfb, ouvrir un dossier lancerait xdg-open : on enregistre l'appel, on ne l'exécute pas.
  shell.showItemInFolder = (p) => {
    g.__s.dossiers.push(String(p))
  }
})
const espion = () => app.evaluate(() => globalThis.__s)
const minuteries = () =>
  app.evaluate(() => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length)

let encre = null
let inter = null
for (let i = 0; i < 40 && !(encre && inter); i++) {
  await pause(400)
  encre = app.windows().find((w) => w.url().includes('index.html'))
  inter = app.windows().find((w) => w.url().includes('ui.html'))
}
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.waitForSelector('.toolbar', { timeout: 20000 })
for (const w of [encre, inter]) {
  await w.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = {
      ...(s.state ?? {}),
      onboarded: true,
      fadeDelay: null,
      toolbarVisible: true,
      globalShortcutsOn: false,
      globalShortcutsChosen: true,
      keymapPreset: 'epicpen',
      keymapPresetChosen: true,
    }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
}
await encre.reload()
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.reload()
await inter.waitForSelector('.toolbar', { timeout: 20000 })
await pause(1000)

const f8 = async () => {
  await encre.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })))
  await pause(600)
}
const modeDessin = async (voulu) => {
  for (let i = 0; i < 3; i++) {
    const actuel = await encre.evaluate(() => window.hexa.modeDessin())
    if (actuel === voulu) return
    await f8()
  }
}
const ouvrirReglages = async () => {
  await inter.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) =>
      (x.getAttribute('title') ?? '').toLowerCase().includes('réglage'),
    )
    b?.click()
  })
  await inter.waitForSelector('.hx-sec', { timeout: 8000 })
}
const texte = (sel) => inter.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel)
const attribut = (sel, a) => inter.evaluate(([s, at]) => document.querySelector(s)?.getAttribute(at) ?? '', [sel, a])

/* ================================================================== *
 * 1. L'assistant OBS : le témoin bouge tout seul
 * ================================================================== */
console.log('\n--- 1. Assistant OBS ---')
await modeDessin(true)
await ouvrirReglages()
await pause(800)
{
  const avant = await texte('.hx-obs-temoin')
  dit('1.1 sans OBS : « aucune source connectée »', /aucune source/.test(avant), avant)
  const adresse = await texte('.hx-url code')
  dit('1.2 l’adresse à coller est affichée', /^http:\/\/127\.0\.0\.1:\d+\/obs\.html$/.test(adresse), adresse)
  const st = await encre.evaluate(() => window.hexa.obsStatus())
  const port = st?.port ?? 0
  const jeton = st?.url ? new URL(st.url).searchParams.get('k') : null
  // une vraie poignée de main WebSocket, comme celle de la source navigateur d'OBS
  const socket = await new Promise((res) => {
    const cle = randomBytes(16).toString('base64')
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/?k=${jeton}`,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': cle,
        'sec-websocket-version': '13',
      },
    })
    req.on('upgrade', (r, s) => {
      const attendu = createHash('sha1').update(cle + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      s.on('data', () => {})
      res(r.headers['sec-websocket-accept'] === attendu ? s : null)
    })
    req.on('response', () => res(null))
    req.on('error', () => res(null))
    req.end()
  })
  await pause(1200)
  const pendant = await texte('.hx-obs-temoin')
  const statut = await attribut('.hx-obs-temoin', 'data-status')
  dit(
    '1.3 une vue se branche : le témoin passe à « 1 source connectée », sans rien toucher',
    !!socket && /1 source connectée/.test(pendant) && statut === 'connected',
    `${pendant} [${statut}]`,
  )
  await inter.evaluate(() => document.querySelector('.hx-obs-assistant')?.scrollIntoView())
  await pause(200)
  await inter.screenshot({ path: join(OUT, '01-temoin-connecte.png') })
  socket?.destroy()
  await pause(1200)
  const apres = await texte('.hx-obs-temoin')
  dit('1.4 la vue part : retour à « aucune source »', /aucune source/.test(apres), apres)
}

/* ================================================================== *
 * 2. Le témoin « Coût actuel »
 * ================================================================== */
console.log('\n--- 2. Témoin « Coût actuel » ---')
{
  await modeDessin(true)
  await encre.keyboard.press('c')
  const m0 = (await espion()).metrics
  await pause(4600)
  const t = await texte('.hx-cout')
  const m1 = (await espion()).metrics
  dit('2.1 panneau ouvert : le témoin affiche processeur, mémoire, images/s, surface', /Processeur/.test(t) && /Mo/.test(t) && /Images/.test(t) && /Surface/.test(t), t.slice(0, 160))
  dit('2.2 une lecture toutes les 2 s (métriques lues dans le principal)', m1 - m0 >= 2 && m1 - m0 <= 4, `${m1 - m0} lectures en 4,6 s`)
  const brut = await inter.evaluate(() => window.hexa.cout())
  const encreFen = brut?.fenetres?.find((f) => f.titre === 'Hexa Overlay')
  dit(
    '2.3 en mode dessin, écran vide : la couche encre ne produit AUCUNE image',
    !!encreFen && encreFen.imagesParSeconde === 0 && encreFen.visible === true,
    `Hexa Overlay : ${encreFen?.imagesParSeconde} image/s, ${encreFen?.largeur}×${encreFen?.hauteur}, surface ${encreFen?.surface} %`,
  )
  await inter.evaluate(() => document.querySelector('.hx-cout')?.scrollIntoView())
  await pause(200)
  await inter.screenshot({ path: join(OUT, '02-cout.png') })
  await inter.keyboard.press('Escape')
  await pause(700)
  const ferme = await inter.evaluate(() => !document.querySelector('.hx-sec'))
  const m2 = (await espion()).metrics
  await pause(6000)
  const m3 = (await espion()).metrics
  dit('2.4 panneau fermé : plus AUCUNE lecture (0 en 6 s)', ferme && m3 === m2, `${m3 - m2} lecture(s) après fermeture`)
}

/* ================================================================== *
 * 3. La sonde de 30 s
 * ================================================================== */
console.log('\n--- 3. Diagnostic de performance (30 s) ---')
{
  await modeDessin(false)
  await pause(800)
  const timersAvant = await minuteries()
  // Les méthodes de fenêtre telles qu'elles sont AVANT la sonde (certaines sont
  // déjà des propriétés propres, posées par Electron lui-même) : après la sonde,
  // chaque fenêtre doit porter exactement les mêmes fonctions.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__avant = new Map(
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => [w.id, ['hide', 'show', 'showInactive', 'setBounds', 'setAlwaysOnTop', 'focus'].map((m) => w[m])]),
    )
  })
  const debut = Date.now()
  // lancée depuis la fenêtre d'interface, comme le bouton des réglages ;
  // le menu de l'icône appelle exactement la même fonction
  const promesse = inter.evaluate(() => window.hexa.lancerSonde())
  await pause(9000)
  // un trait au milieu de la mesure : le rapport doit le voir
  await modeDessin(true)
  const m = encre.mouse
  await m.move(400, 400)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(400 + i * 20, 400 + Math.sin(i / 3) * 40, { steps: 2 })
  await m.up()
  await pause(500)
  await modeDessin(false)
  const lu = await inter.evaluate(() => window.hexa.captureFenetre())
  dit('3.1 pendant la mesure, le principal sait qu’une sonde tourne', lu?.sondeEnCours === true, JSON.stringify(lu))
  const resultat = await promesse
  const duree = Date.now() - debut
  dit('3.2 la sonde rend la main après ~34 s (3,5 s de bandeau + 30 s)', duree >= 33000 && duree < 45000, `${Math.round(duree / 100) / 10} s`)
  dit(
    '3.3 un JSON et un résumé sont écrits dans le dossier utilisateur',
    !!resultat?.json && !!resultat?.resume && existsSync(resultat.json) && existsSync(resultat.resume),
    `${resultat?.resume ?? 'aucun fichier'}`,
  )
  const dossiers = (await espion()).dossiers
  dit('3.4 le dossier est ouvert (shell.showItemInFolder)', dossiers.length === 1 && dossiers[0] === resultat?.resume, JSON.stringify(dossiers))

  const rapport = JSON.parse(readFileSync(resultat.json, 'utf8'))
  const s = rapport.synthese
  console.log(`  conclusion : ${s.conclusion}`)
  dit(
    '3.5 le résumé CONCLUT en français, avec les chiffres attendus',
    /^Pendant ces \d+ s, Hexa a occupé [\d,]+ % de ton processeur/.test(s.conclusion) && /Mo de mémoire/.test(s.conclusion) && /% de l’écran/.test(s.conclusion),
    s.conclusion.slice(0, 120),
  )
  const encreRap = rapport.fenetres.find((f) => f.titre === 'Hexa Overlay')
  const couche = rapport.couchesEncre.find((c) => c.titre === 'Hexa Overlay')
  dit(
    '3.6 le trait posé pendant la mesure est vu : images > 0 sur la couche encre, 1 annotation vivante',
    !!encreRap && encreRap.images > 0 && couche?.vivantes === 1 && couche?.annotation === true,
    `Hexa Overlay : ${encreRap?.images} images, ${couche?.vivantes} vivante(s), ${couche?.archivees} archivée(s)`,
  )
  dit(
    '3.7 chaque processus est relevé (principal, rendu, GPU…) avec processeur et mémoire',
    Array.isArray(rapport.processus) && rapport.processus.length >= 3 && rapport.processus.every((p) => typeof p.cpu === 'number' && p.memoireMo > 0),
    rapport.processus.map((p) => `${p.type}:${p.memoireMo}Mo`).join(' '),
  )
  dit(
    '3.8 la configuration est décrite : écrans, écran d’annotation, accélération, capture',
    Array.isArray(rapport.configuration.ecrans) && /ANNOTATION/.test(rapport.configuration.ecrans.join(' ')) && typeof rapport.systeme.accelerationMaterielle.compositionGpu === 'string' && /oui/.test(rapport.configuration.fenetreCapturableObs),
    `${rapport.configuration.ecrans.join(' | ')} · composition GPU : ${rapport.systeme.accelerationMaterielle.compositionGpu}`,
  )
  dit(
    '3.9 relevés toutes les 2 s, appels de fenêtre comptés, OBS relevé',
    rapport.releves.length >= 13 && typeof s.appelsFenetre === 'number' && typeof s.obs.octetsEnvoyes === 'number',
    `${rapport.releves.length} relevés · ${s.appelsFenetre} appels de fenêtre · OBS ${s.obs.serveur}, ${s.obs.octetsEnvoyes} octets`,
  )
  const resume = readFileSync(resultat.resume, 'utf8')
  dit('3.10 le résumé texte est lisible par un non-développeur', /CONCLUSION/.test(resume) && /EN CHIFFRES/.test(resume) && /envoyé nulle part/.test(resume), `${resume.split('\n').length} lignes`)
  console.log('  ' + resume.split('\n').slice(0, 12).join('\n  '))

  // rien ne reste : ni minuterie, ni méthode enrobée, ni lecture périodique.
  // (Le bandeau « Diagnostic terminé » vit 7 s avec sa propre minuterie : on
  //  attend qu'il soit parti avant de compter.)
  await pause(8000)
  const timersApres = await minuteries()
  const enrobees = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && globalThis.__avant.has(w.id))
      .flatMap((w) =>
        ['hide', 'show', 'showInactive', 'setBounds', 'setAlwaysOnTop', 'focus']
          .filter((m, i) => w[m] !== globalThis.__avant.get(w.id)[i])
          .map((m) => `${w.getTitle()}.${m}`),
      ),
  )
  dit('3.11 après la sonde : chaque méthode de fenêtre est redevenue celle d’avant', enrobees.length === 0, enrobees.join(' ') || 'aucune méthode enrobée')
  dit('3.12 après la sonde : pas plus de minuteries qu’avant', timersApres <= timersAvant, `${timersAvant} → ${timersApres} Timeout actifs dans le principal`)
  const m4 = (await espion()).metrics
  await pause(5000)
  const m5 = (await espion()).metrics
  dit('3.13 après la sonde : plus aucune lecture de métriques (0 en 5 s)', m5 === m4, `${m5 - m4} lecture(s)`)
  const fichiers = readdirSync(rapport ? join(USER, 'diagnostics') : USER)
  console.log(`  fichiers écrits : ${fichiers.join(', ')}`)
}

await app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
