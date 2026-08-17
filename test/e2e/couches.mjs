#!/usr/bin/env node
/**
 * Hexa — §S11 : LES DEUX FENÊTRES, sur la VRAIE application.
 *
 * Ce que ce script prouve, dans l'ordre où ça compte pour un streamer :
 *   1. il y a bien DEUX fenêtres par écran, et on sait laquelle porte quoi ;
 *   2. la fenêtre d'INTERFACE est marquée « exclue des captures », la fenêtre
 *      d'ENCRE ne l'est JAMAIS (sinon les spectateurs perdraient le dessin) ;
 *   3. le dessin fonctionne toujours, dans la fenêtre encre ;
 *   4. la barre d'outils, qui vit dans l'autre fenêtre, pilote réellement le
 *      moteur — et l'état des deux fenêtres ne diverge pas ;
 *   5. la fenêtre d'interface ne devient cliquable qu'au survol de ses boutons,
 *      et redevient traversante en repartant (jamais un clic volé au jeu) ;
 *   6. elle prend le focus quand un panneau s'ouvre, et le rend ensuite ;
 *   7. elle disparaît quand elle n'a plus rien à montrer (règle §2.5).
 *
 * Utilisation (depuis la racine, application construite) :
 *   npm run build && npm run build:main
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/couches.mjs
 *
 * ⚠️ setContentProtection est un mécanisme WINDOWS (et macOS) : sous X11 il ne
 * masque rien. Ce script vérifie donc que l'appel est FAIT, sur la BONNE
 * fenêtre, avec la BONNE valeur — la disparition réelle à l'image se constate
 * sous Windows, dans OBS.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = resolve(ICI, '..', '..')
const SORTIE = process.env.HEXA_E2E_OUT
  ? resolve(process.env.HEXA_E2E_OUT)
  : join(RACINE, 'test', 'e2e', 'captures-couches')

// Playwright n'est pas une dépendance d'Hexa : on le cherche là où il est,
// exactement comme la campagne principale (test/e2e/harness.mjs).
const { chargerPilote } = await import('./harness.mjs')
const electron = await chargerPilote()

const resultats = []
const ok = (nom, objet, detail) => resultats.push({ nom, objet, statut: 'OK', detail })
const ko = (nom, objet, detail) => resultats.push({ nom, objet, statut: 'KO', detail })
const verdict = (cond, nom, objet, detail) => (cond ? ok : ko)(nom, objet, detail)

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

rmSync(SORTIE, { recursive: true, force: true })
mkdirSync(SORTIE, { recursive: true })

const app = await electron.launch({
  args: ['.', `--user-data-dir=${join(SORTIE, '.user-data')}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})

/* --- espion posé dans le processus principal : on veut des PREUVES ------ */
await app.evaluate(({ ipcMain, BrowserWindow, app: electronApp }) => {
  const g = globalThis
  g.__hexaTrace = { cliquable: [], modale: [], protection: [] }
  ipcMain.on('hexa:interface-cliquable', (_e, v) => g.__hexaTrace.cliquable.push(v === true))
  ipcMain.on('hexa:interface-modale', (_e, v) => g.__hexaTrace.modale.push(v === true))
  const instrumenter = (w) => {
    const original = w.setContentProtection.bind(w)
    w.setContentProtection = (on) => {
      // L'adresse, et pas le titre : le bandeau d'accueil s'appelle « Hexa »
      // lui aussi, et il est légitimement exclu des captures (§S11).
      let url = ''
      try {
        url = w.webContents.getURL()
      } catch {
        /* fenêtre en cours de destruction */
      }
      g.__hexaTrace.protection.push({ titre: w.getTitle(), url, on: on === true })
      return original(on)
    }
  }
  BrowserWindow.getAllWindows().forEach(instrumenter)
  electronApp.on('browser-window-created', (_e, w) => instrumenter(w))
})

await app.firstWindow({ timeout: 30000 })
await pause(3200)

/* --- 1. qui est qui ? --------------------------------------------------- */
const pages = []
for (const w of app.windows()) {
  const d = await w.evaluate(() => ({
    page: location.pathname.split('/').pop() ?? '',
    couche: [...document.body.classList].find((c) => c.startsWith('hexa-')) ?? '',
    canvas: document.querySelectorAll('canvas').length,
    barre: !!document.querySelector('.toolbar'),
    stage: !!document.querySelector('.stage'),
  })).catch(() => null)
  if (d) pages.push({ w, ...d })
}
const encre = pages.find((p) => p.canvas > 0 && p.couche === 'hexa-encre')
const inter = pages.find((p) => p.barre && p.couche === 'hexa-interface')

verdict(
  !!encre && !!inter,
  's11-01-deux-fenetres',
  'Deux fenêtres : une pour l’encre, une pour l’interface',
  `encre=${encre?.page ?? 'ABSENTE'} (${encre?.canvas ?? 0} canevas) · interface=${
    inter?.page ?? 'ABSENTE'
  }`,
)
if (!encre || !inter) {
  rendre()
  await app.close()
  process.exit(1)
}
verdict(
  encre.canvas > 0 && !encre.barre,
  's11-02-encre-sans-barre',
  'La couche encre ne porte AUCUN élément d’interface',
  `${encre.canvas} canevas, barre d’outils : ${encre.barre ? 'PRÉSENTE (défaut)' : 'absente'}`,
)
verdict(
  inter.barre && inter.canvas === 0,
  's11-03-interface-sans-canevas',
  'La couche interface ne porte AUCUN canevas d’annotation',
  `barre présente, ${inter.canvas} canevas`,
)

/* --- 2. protection de capture ------------------------------------------ */
const trace = () => app.evaluate(() => globalThis.__hexaTrace)
{
  const t = await trace()
  const surInterface = t.protection.filter((p) => /ui\.html/i.test(p.url) && p.on)
  // La couche encre = index.html. Le bandeau d'accueil (data: URL) est, lui,
  // protégé exprès : c'est lui qui annonçait « clics rendus au jeu » en direct.
  const fauteSurEncre = t.protection.filter((p) => /index\.html/i.test(p.url) && p.on)
  const bandeau = t.protection.filter((p) => p.url.startsWith('data:') && p.on)
  verdict(
    surInterface.length > 0,
    's11-04-protection-interface',
    'La fenêtre d’interface est marquée « exclue des captures »',
    `setContentProtection(true) appelé ${surInterface.length} fois sur ui.html · bandeau d’accueil protégé : ${bandeau.length} fois`,
  )
  verdict(
    fauteSurEncre.length === 0,
    's11-05-encre-jamais-protegee',
    'La couche encre n’est JAMAIS masquée aux captures',
    fauteSurEncre.length === 0
      ? 'aucun appel à true sur index.html — les spectateurs voient le dessin'
      : `DANGER : ${fauteSurEncre.length} appel(s) à true sur la couche encre`,
  )
}

/* --- 3. le dessin, toujours ------------------------------------------- */
{
  // fondu coupé : sinon le trait s'effacerait tout seul pendant la mesure
  await encre.w.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = { ...(s.state ?? {}), fadeDelay: null, onboarded: true }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
  await encre.w.reload()
  await encre.w.waitForSelector('.stage canvas', { timeout: 20000 })
  await inter.w.reload()
  await inter.w.waitForSelector('.toolbar', { timeout: 20000 })
  await pause(1500)
  const m = encre.w.mouse
  await m.move(500, 480)
  await m.down()
  for (let i = 1; i <= 26; i++) {
    await m.move(500 + i * 20, 480 - Math.sin((i / 26) * Math.PI) * 170, { steps: 2 })
    await pause(6)
  }
  await m.up()
  await pause(700)
  const px = await encre.w.evaluate(() => {
    let total = 0
    for (const c of document.querySelectorAll('canvas')) {
      const ctx = c.getContext('2d')
      // Un canvas à 0×0 est un canvas volontairement RENDU À LA MÉMOIRE : les
      // couches loupe/gel/flou et le voile du spotlight ne sont dimensionnées
      // que pendant leur usage. getImageData y lèverait une IndexSizeError.
      if (!ctx || c.width === 0 || c.height === 0) continue
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4 * 53) if (d[i] > 8) total++
    }
    return total
  })
  verdict(
    px > 100,
    's11-06-dessin',
    'Le dessin fonctionne dans la couche encre',
    `${px} échantillons d’encre après un trait (0 = rien n’a été peint)`,
  )
  await encre.w.screenshot({ path: join(SORTIE, 's11-06-encre-trait.png') })
}

/* --- 4. la barre pilote le moteur, sans divergence ---------------------- */
{
  const avant = await encre.w.evaluate(() => document.querySelector('.stage')?.dataset.tool)
  const bouton = inter.w.locator('.toolbar button[title*="Surligneur" i]').first()
  await bouton.click({ timeout: 5000 })
  await pause(400)
  const apres = await encre.w.evaluate(() => document.querySelector('.stage')?.dataset.tool)
  verdict(
    avant !== 'highlight' && apres === 'highlight',
    's11-07-barre-vers-moteur',
    'Un clic sur la barre change l’outil du moteur (autre fenêtre)',
    `outil de la couche encre : ${avant} → ${apres}`,
  )

  // …et dans l'autre sens : le clavier agit sur l'encre, l'interface suit.
  await encre.w.keyboard.press('r')
  await pause(400)
  const deux = {
    encre: await encre.w.evaluate(() => document.querySelector('.stage')?.dataset.tool),
    interface: await inter.w.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
      return st?.state?.tool ?? '?'
    }),
  }
  verdict(
    deux.encre === 'rect' && deux.interface === 'rect',
    's11-08-etat-identique',
    'Les deux fenêtres ne divergent jamais',
    `après la touche R : encre=${deux.encre} · interface=${deux.interface}`,
  )
  // « Annuler » depuis la barre : la commande traverse bien les deux fenêtres,
  // et on le mesure en PIXELS — un bouton qui s'allume ne prouve rien.
  const mesurer = () =>
    encre.w.evaluate(() => {
      let n = 0
      for (const c of document.querySelectorAll('canvas')) {
        const x = c.getContext('2d')
        if (!x) continue
        if (c.width === 0 || c.height === 0) continue
        const d = x.getImageData(0, 0, c.width, c.height).data
        for (let i = 3; i < d.length; i += 4 * 53) if (d[i] > 8) n++
      }
      return n
    })
  const avantUndo = await mesurer()
  // ⚠️ `title^=` et non `title*=` : l'info-bulle des formes intelligentes
  // contient elle aussi le mot « annuler ».
  await inter.w.locator('.toolbar button[title^="Annuler" i]').first().click({ timeout: 8000 })
  await pause(1200)
  const apresUndo = await mesurer()
  verdict(
    avantUndo > 100 && apresUndo === 0,
    's11-09-commande-annuler',
    'Le bouton « Annuler » de la barre efface vraiment le trait de l’autre fenêtre',
    `encre ${avantUndo} → ${apresUndo}`,
  )
  await inter.w.screenshot({ path: join(SORTIE, 's11-09-interface.png') })
}

/* --- 5. la souris : cliquable seulement là où il faut ------------------- */
{
  const r = await inter.w.evaluate(() => {
    const b = document.querySelector('.toolbar').getBoundingClientRect()
    return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) }
  })
  const avant = (await trace()).cliquable.length
  await inter.w.mouse.move(40, 40)
  await pause(150)
  await inter.w.mouse.move(r.cx, r.cy, { steps: 3 })
  await pause(250)
  const surBarre = (await trace()).cliquable
  verdict(
    surBarre.slice(avant).includes(true),
    's11-10-survol-barre',
    'La fenêtre d’interface devient cliquable au survol de la barre',
    `bascules observées : ${JSON.stringify(surBarre.slice(avant))}`,
  )
  await inter.w.mouse.move(40, 600, { steps: 3 })
  await pause(250)
  const apres = (await trace()).cliquable
  verdict(
    apres[apres.length - 1] === false,
    's11-11-sortie-barre',
    'Elle redevient traversante dès qu’on quitte la barre (aucun clic volé au jeu)',
    `dernier état : ${apres[apres.length - 1]}`,
  )
}

/* --- 6. panneau ouvert : focus clavier --------------------------------- */
{
  await inter.w.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) =>
      (x.getAttribute('title') ?? '').toLowerCase().includes('réglage'),
    )
    b?.click()
  })
  await pause(800)
  const t = await trace()
  const panneau = await inter.w.evaluate(() => !!document.querySelector('.hx-sec'))
  const panneauDansEncre = await encre.w.evaluate(() => !!document.querySelector('.hx-sec'))
  verdict(
    panneau && !panneauDansEncre && t.modale.includes(true),
    's11-12-panneau',
    'Les panneaux s’ouvrent dans la fenêtre d’interface, qui prend alors le clavier',
    `panneau côté interface : ${panneau} · côté encre : ${panneauDansEncre} · modale : ${JSON.stringify(
      t.modale,
    )}`,
  )
  await inter.w.screenshot({ path: join(SORTIE, 's11-12-reglages.png') })
  await inter.w.keyboard.press('Escape')
  await pause(500)
  const ferme = await inter.w.evaluate(() => !document.querySelector('.hx-sec'))
  verdict(ferme, 's11-13-echap', 'Échap referme le panneau depuis la fenêtre d’interface', `fermé : ${ferme}`)
}

/* --- 7. §2.5 : l'interface se cache quand elle n'a rien à montrer ------ */
{
  const visible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.getTitle().includes('interface'))
        .map((w) => w.isVisible()),
    )
  const avant = await visible()
  await encre.w.keyboard.press('Control+h') // masquer la barre (preset Epic Pen)
  await pause(900)
  const apres = await visible()
  verdict(
    avant.some(Boolean) && apres.every((v) => v === false),
    's11-14-fenetre-cachee',
    'Barre masquée : la fenêtre d’interface se retire (coût compositeur nul, §2.5)',
    `visible avant : ${JSON.stringify(avant)} → après : ${JSON.stringify(apres)}`,
  )
  await encre.w.keyboard.press('Control+h')
  await pause(700)
  const retour = await visible()
  verdict(
    retour.some(Boolean),
    's11-15-fenetre-revient',
    'Elle revient dès que la barre est redemandée',
    `visible : ${JSON.stringify(retour)}`,
  )
}

/* --- 7 bis. le rejeu (§11) part bien à l'antenne ----------------------- */
{
  // « Rejouer la session » se commande depuis les réglages (fenêtre interface)
  // mais se JOUE dans la couche encre, avec l'enregistreur et le moteur : un
  // rejeu se regarde, il doit donc être capturé comme une annotation.
  await inter.w.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) =>
      (x.getAttribute('title') ?? '').toLowerCase().includes('réglage'),
    )
    b?.click()
  })
  await pause(700)
  const lance = await inter.w.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => x.textContent?.trim() === 'Rejouer la session',
    )
    b?.click()
    return !!b
  })
  await pause(1500)
  const ou = {
    encre: await encre.w.evaluate(() => !!document.querySelector('.replay-bar, [class*="replay"]')),
    interface: await inter.w.evaluate(
      () => !!document.querySelector('.replay-bar, [class*="replay"]'),
    ),
  }
  verdict(
    lance && ou.encre && !ou.interface,
    's11-17-rejeu',
    'Le rejeu se joue dans la couche encre (donc visible par les spectateurs)',
    `bouton trouvé : ${lance} · barre de rejeu côté encre : ${ou.encre} · côté interface : ${ou.interface}`,
  )
  await encre.w.screenshot({ path: join(SORTIE, 's11-17-rejeu.png') })
  await encre.w.keyboard.press('Escape')
  await pause(400)
}

/* --- 8. le bandeau d'accueil non plus ne part pas dans le direct -------- */
{
  // C'est LUI que l'utilisateur voyait s'afficher en plein direct : « Hexa se
  // met en retrait — tes clics repartent dans ton jeu ». Il vit dans sa propre
  // petite fenêtre (data: URL) : elle est protégée comme l'interface.
  // La séquence d'accueil en affiche un second à la fin de sa temporisation :
  // on l'attend, c'est la preuve la plus directe.
  // On en provoque un À COUP SÛR : relancer Hexa alors qu'il tourne déjà fait
  // apparaître le bandeau « Hexa tourne déjà » (verrou d'instance unique).
  const { spawn } = await import('node:child_process')
  const second = spawn(
    join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
    ['.', `--user-data-dir=${join(SORTIE, '.user-data')}`],
    { cwd: RACINE, stdio: 'ignore' },
  )
  let bandeau = []
  const limite = Date.now() + 12000
  while (Date.now() < limite) {
    bandeau = (await trace()).protection.filter((p) => p.url.startsWith('data:'))
    if (bandeau.length > 0) break
    await pause(500)
  }
  second.kill()
  verdict(
    bandeau.length > 0 && bandeau.every((p) => p.on),
    's11-16-bandeau-accueil',
    'Le bandeau « clics rendus au jeu » est exclu des captures, lui aussi',
    bandeau.length > 0
      ? `${bandeau.length} bandeau(x) marqué(s) : ${bandeau.map((p) => p.on).join(', ')}`
      : 'aucun bandeau observé pendant la fenêtre d’observation',
  )
}

await app.close().catch(() => {})
rendre()

function rendre() {
  const large = Math.max(...resultats.map((r) => r.objet.length), 10)
  console.log('\n================ §S11 — SÉPARATION EN DEUX FENÊTRES ================')
  for (const r of resultats) {
    console.log(
      `${r.statut === 'OK' ? '  ok ' : ' KO  '} ${r.nom.padEnd(26)} ${r.objet.padEnd(large)}  ${r.detail}`,
    )
  }
  const bons = resultats.filter((r) => r.statut === 'OK').length
  console.log(`\n${bons} FONCTIONNE · ${resultats.length - bons} CASSÉ`)
  console.log(`captures : ${SORTIE}`)
  if (bons !== resultats.length) process.exitCode = 1
}
