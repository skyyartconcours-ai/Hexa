import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Playwright n'est PAS une dépendance d'Hexa (l'application livrée ne doit pas
 * grossir d'un pilote). On le cherche là où il se trouve, comme le fait
 * test/e2e/harness.mjs, et on dit quoi faire s'il manque.
 */
async function chargerPilote() {
  const globalNode = join(dirname(dirname(process.execPath)), 'lib', 'node_modules')
  const pistes = [
    process.env.HEXA_E2E_PLAYWRIGHT,
    'playwright-core',
    'playwright',
    join(process.cwd(), 'node_modules', 'playwright-core', 'index.js'),
    join(globalNode, 'playwright-core', 'index.js'),
    join(globalNode, 'playwright', 'index.js'),
    join(globalNode, 'playwright', 'node_modules', 'playwright-core', 'index.js'),
  ].filter(Boolean)
  for (const piste of pistes) {
    try {
      if (piste.includes('/') && !existsSync(piste)) continue
      const spec = piste.includes('/') ? pathToFileURL(piste).href : piste
      const mod = await import(spec)
      const e = mod._electron ?? mod.default?._electron
      if (e) return e
    } catch {
      /* piste suivante */
    }
  }
  throw new Error(
    'Playwright introuvable. Installe-le sans toucher aux dépendances d’Hexa :\n' +
      '  npm i -g playwright\n' +
      'ou : HEXA_E2E_PLAYWRIGHT=/chemin/vers/playwright-core/index.js node test/e2e/s6-stream-fx.mjs',
  )
}

const electron = await chargerPilote()

/* Campagne S6 — effets stream et outils pédagogiques (§5.2, §5.4, §5.8).
   Lancement :
     cd <racine> && npm run build && npm run build:main
     xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/s6-stream-fx.mjs [section]
   Sections : grid · clock · rebours · note · spot · idle · clavier · jeu · all */

const OUT = `${dirname(fileURLToPath(import.meta.url))}/captures/s6/`
mkdirSync(OUT, { recursive: true })
const only = process.argv[2] ?? 'all'

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  executablePath: `${process.cwd()}/node_modules/electron/dist/electron`,
  timeout: 60000,
})
const win = await app.firstWindow({ timeout: 30000 })
win.on('pageerror', (e) => console.log('[ERREUR RENDERER]', e.message))
win.on('console', (m) => {
  if (m.type() === 'error') console.log('[renderer]', m.type(), m.text())
})

const URL0 = win.url()
const shot = (n) => win.screenshot({ path: `${OUT}${n}.png` })
let casse = 0
const ok = (t, v) => {
  if (!v) casse++
  console.log(`${v ? 'FONCTIONNE' : '*** CASSÉ'} · ${t}`)
}

/** état de départ déterministe : on écrit l'état persisté et on recharge.
 *  Aucun crochet de test n'existe dans le code de production. */
const seed = async (patch) => {
  await win.evaluate((p) => {
    const raw = JSON.parse(localStorage.getItem('hexa-ui') ?? '{"state":{},"version":2}')
    raw.state = { ...raw.state, ...p, onboarded: true }
    localStorage.setItem('hexa-ui', JSON.stringify(raw))
  }, patch)
  await win.goto(URL0)
  await win.waitForTimeout(1400)
  if (await win.evaluate(() => document.body.classList.contains('passthrough'))) {
    await win.keyboard.press('F8')
    await win.waitForTimeout(300)
  }
}

await win.waitForTimeout(6500) // séquence d'accueil (S1)
await seed({ clocks: [], notes: [], gridMode: 'off', tool: 'pen', color: '#00e5ff' })
console.log('prêt · passthrough =', await win.evaluate(() => document.body.classList.contains('passthrough')))

/* ---------------- 1. GRILLE ET RÈGLE DES TIERS (§5.8.1) ---------------- */
if (only === 'all' || only === 'grid') {
  console.log('\n=== 1. GRILLE ET RÈGLE DES TIERS ===')
  const grid = win.locator('.toolbar button[title^="Cadrage"]')
  ok('bouton Cadrage présent dans la barre', (await grid.count()) === 1)
  for (const [i, nom] of ['01-grille', '02-tiers', '03-grille-et-tiers'].entries()) {
    await grid.click()
    await win.waitForTimeout(280)
    const s = await win.evaluate(() => {
      const el = document.querySelector('.stage-grid')
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        calques: cs.backgroundImage.split(/,(?![^(]*\))/).length,
        titre: document.querySelector('.toolbar button[title^="Cadrage"]').title.slice(0, 46),
      }
    })
    console.log(`clic ${i + 1} :`, JSON.stringify(s))
    ok(`superposition ${nom} affichée`, s != null && s.calques >= 2)
    await shot(nom)
  }
  const order = await win.evaluate(() => {
    const g = document.querySelector('.stage-grid')
    const st = document.querySelector('.stage')
    return g.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING ? 'avant' : 'après'
  })
  ok(`grille placée ${order} la scène → sous les annotations`, order === 'avant')

  const m = win.mouse
  await m.move(300, 300)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(300 + i * 24, 320 + Math.sin(i / 3) * 70, { steps: 2 })
  await m.up()
  await win.waitForTimeout(500)
  await shot('04-grille-sous-annotation')
  await grid.click() // retour à « aucune »
  await win.waitForTimeout(250)
  ok('4e clic : le cycle revient à « aucune »', (await win.locator('.stage-grid').count()) === 0)
  await win.keyboard.press('KeyC')
  await win.waitForTimeout(900)
}

/* ---------------- 2. CHRONO (§5.8.2) ---------------- */
if (only === 'all' || only === 'clock') {
  console.log('\n=== 2. CHRONO ===')
  await seed({ clocks: [], notes: [], gridMode: 'off' })
  const chrono = win.locator('.toolbar button[title^="Poser un chrono"]')
  ok('bouton Chrono présent', (await chrono.count()) === 1)
  await chrono.click()
  await win.waitForTimeout(400)
  ok('carte chrono posée', (await win.locator('.sw-clock').count()) === 1)
  await shot('05-chrono-pose')

  await win.locator('.sw-btn.primary').first().click()
  await win.waitForTimeout(1300)
  const t1 = await win.locator('.sw-digits').first().textContent()
  await win.waitForTimeout(1100)
  const t2 = await win.locator('.sw-digits').first().textContent()
  console.log('chrono :', t1, '→', t2)
  ok('le chrono avance', t1 !== t2)
  await shot('06-chrono-en-marche')

  await win.locator('.sw-btn.primary').first().click() // pause
  await win.waitForTimeout(250)
  const p1 = await win.locator('.sw-digits').first().textContent()
  await win.waitForTimeout(1000)
  const p2 = await win.locator('.sw-digits').first().textContent()
  ok(`pause : ${p1} figé (${p2})`, p1 === p2)

  await win.locator('.sw-clock .sw-btn').nth(1).click() // remise à zéro
  await win.waitForTimeout(300)
  const z = await win.locator('.sw-digits').first().textContent()
  ok(`remise à zéro → « ${z} »`, z === '0:00.00')
  await shot('07-chrono-zero')
}

/* ---------------- 3. COMPTE À REBOURS (§5.8.2) ---------------- */
if (only === 'all' || only === 'rebours') {
  console.log('\n=== 3. COMPTE À REBOURS ===')
  // posé à 12 s d'un rebours de 20 s : le départ met la carte à 8 s, donc
  // dans la zone d'urgence. Aucun crochet : c'est l'état persisté normal.
  await seed({
    clocks: [{ id: 'c1', kind: 'countdown', x: 520, y: 180, elapsed: 12_000, startedAt: null, duration: 20_000 }],
    notes: [],
    gridMode: 'off',
  })
  ok('carte rechargée depuis l’état persisté', (await win.locator('.sw-clock').count()) === 1)
  const d0 = await win.locator('.sw-digits').first().textContent()
  ok(`affichage à l’arrêt : « ${d0} »`, d0 === '0:08')
  ok('pastilles de durée visibles à l’arrêt', (await win.locator('.sw-step').count()) === 6)
  await shot('08-rebours-arret')

  await win.locator('.sw-btn.primary').first().click()
  await win.waitForTimeout(900)
  const urgent = await win.evaluate(() => ({
    u: document.querySelector('.sw-clock').dataset.urgent,
    t: document.querySelector('.sw-digits').textContent,
    anim: getComputedStyle(document.querySelector('.sw-digits')).animationName,
  }))
  console.log('urgence :', JSON.stringify(urgent))
  ok(`10 dernières secondes : pulsation (${urgent.anim}) à ${urgent.t}`, urgent.u === '1' && urgent.anim === 'sw-urgent')
  await shot('09-rebours-urgence')
  ok('pastilles masquées pendant la marche', (await win.locator('.sw-step').count()) === 0)

  await win.waitForTimeout(7600) // on laisse vraiment tomber à zéro
  const fin = await win.evaluate(() => {
    const el = document.querySelector('.sw-clock')
    return {
      done: el.dataset.done,
      urgent: el.dataset.urgent,
      texte: el.querySelector('.sw-digits').textContent,
      anim: getComputedStyle(el.querySelector('.sw-digits')).animationName,
      arrete: JSON.parse(localStorage.getItem('hexa-ui')).state.clocks[0].startedAt === null,
    }
  })
  console.log('fin :', JSON.stringify(fin))
  ok(`zéro atteint : « ${fin.texte} », battement final ${fin.anim}`, fin.texte === '0:00' && fin.done === '1')
  ok('horloge rangée à l’arrêt (plus rien ne tourne)', fin.arrete === true)
  await shot('10-rebours-zero')
  await win.waitForTimeout(2400)
  await shot('11-rebours-zero-fige')

  // relance : le rebours repart de sa durée pleine
  await win.locator('.sw-btn.primary').first().click()
  await win.waitForTimeout(600)
  const relance = await win.locator('.sw-digits').first().textContent()
  ok(`relance après zéro → ${relance}`, relance === '0:19' || relance === '0:20')
  await win.locator('.sw-clock .sw-close').first().click({ force: true })
  await win.waitForTimeout(300)
  ok('croix : la carte est retirée', (await win.locator('.sw-clock').count()) === 0)
}

/* ---------------- 4. NOTES PERSISTANTES (§5.8.3) ---------------- */
if (only === 'all' || only === 'note') {
  console.log('\n=== 4. NOTES PERSISTANTES ===')
  await seed({ clocks: [], notes: [], gridMode: 'off', tool: 'pen' })
  const note = win.locator('.toolbar button[title^="Poser une note"]')
  ok('bouton Note présent', (await note.count()) === 1)
  await note.click()
  await win.waitForTimeout(450)
  ok('note posée', (await win.locator('.sw-note').count()) === 1)
  await win.locator('.sw-note-text').first().click()
  await win.keyboard.type('Objectif :\n· vision avant le dragon\n· ne jamais pousser seul')
  await win.waitForTimeout(400)
  const h = await win.evaluate(() => {
    const t = document.querySelector('.sw-note-text')
    return { h: Math.round(t.getBoundingClientRect().height), lignes: t.value.split('\n').length }
  })
  console.log('note :', JSON.stringify(h))
  ok('texte multi-lignes, la note grandit', h.h > 50 && h.lignes === 3)
  await shot('12-note')
  await win.keyboard.press('Escape') // rend le clavier à l'application

  const m = win.mouse
  await m.move(980, 620)
  await m.down()
  for (let i = 1; i <= 15; i++) await m.move(980 + i * 16, 620 - i * 5, { steps: 2 })
  await m.up()
  await win.waitForTimeout(400)
  await shot('13-note-et-trait')

  await win.keyboard.press('KeyC') // tout effacer
  await win.waitForTimeout(1500)
  const apres = await win.evaluate(() => ({
    notes: document.querySelectorAll('.sw-note').length,
    lettres: document.querySelector('.sw-note-text')?.value.length ?? 0,
  }))
  ok(`note immunisée au « tout effacer » (${JSON.stringify(apres)})`, apres.notes === 1 && apres.lettres > 40)
  await shot('14-note-apres-panique')

  const before = await win.evaluate(() => {
    const r = document.querySelector('.sw-note').getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })
  await m.move(before.x + 60, before.y + 70)
  await m.down({ button: 'right' })
  await m.move(before.x + 300, before.y + 240, { steps: 14 })
  await m.up({ button: 'right' })
  await win.waitForTimeout(500)
  const after = await win.evaluate(() => {
    const r = document.querySelector('.sw-note').getBoundingClientRect()
    const st = JSON.parse(localStorage.getItem('hexa-ui')).state.notes[0]
    return { x: Math.round(r.x), y: Math.round(r.y), sx: st.x, sy: st.y }
  })
  console.log('déplacement :', JSON.stringify(before), '→', JSON.stringify(after))
  ok(
    `clic droit : +${after.x - before.x}/+${after.y - before.y} px, position enregistrée`,
    after.x - before.x > 180 && after.y - before.y > 150 && after.sx === after.x,
  )
  await shot('15-note-deplacee')

  await win.locator('.sw-note').first().hover()
  await win.waitForTimeout(350)
  const croix = await win.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.sw-note-close')).opacity),
  )
  ok(`croix de fermeture visible au survol (opacité ${croix})`, croix > 0.9)
  await shot('16-note-survol')

  // persistance réelle : rechargement complet de la fenêtre
  await win.goto(URL0)
  await win.waitForTimeout(1600)
  const recharge = await win.evaluate(() => {
    const n = document.querySelector('.sw-note')
    return n ? { texte: n.querySelector('textarea').value.length, x: Math.round(n.getBoundingClientRect().x) } : null
  })
  console.log('après rechargement :', JSON.stringify(recharge))
  ok('la note survit au redémarrage de l’interface', recharge != null && recharge.texte > 40)
  await shot('17-note-persistee')
}

/* ---------------- 5. SPOTLIGHT : RECTANGLE ET LASSO (§5.2) ---------------- */
if (only === 'all' || only === 'spot') {
  console.log('\n=== 5. SPOTLIGHT ===')
  await seed({ clocks: [], notes: [], gridMode: 'off', tool: 'pen' })
  // quelques annotations : elles doivent rester LUMINEUSES à travers le voile
  const m = win.mouse
  for (const [x, y] of [[520, 330], [900, 560]]) {
    await m.move(x, y)
    await m.down()
    for (let i = 1; i <= 12; i++) await m.move(x + i * 18, y + Math.sin(i / 2) * 40, { steps: 2 })
    await m.up()
  }
  await win.locator('.toolbar button[title^="Spotlight"]').click()
  await win.waitForTimeout(500)
  await m.move(760, 420)
  await win.waitForTimeout(600)
  await shot('18-spot-disque')

  await m.move(420, 260)
  await m.down()
  await m.move(1100, 640, { steps: 16 })
  await win.waitForTimeout(150)
  await shot('19-spot-rect-en-cours')
  await m.up()
  await win.waitForTimeout(600)
  await shot('20-spot-rect')

  const profil = await win.evaluate(() => {
    const cv = document.querySelector('.veil-canvas')
    const ctx = cv.getContext('2d')
    const dpr = cv.width / window.innerWidth
    const y = Math.round(450 * dpr)
    const d = ctx.getImageData(0, y, cv.width, 1).data
    const out = []
    for (let x = 340; x <= 500; x += 8) out.push(d[Math.round(x * dpr) * 4 + 3])
    return out
  })
  console.log('alpha du voile de x=340 à 500 (pas de 8 px) :', profil.join(' '))
  ok(
    `bord dégradé : ${new Set(profil).size} paliers d'alpha sur la transition`,
    new Set(profil).size >= 8,
  )

  await win.keyboard.down('Alt')
  await m.move(760 + 210, 460)
  await m.down()
  for (let i = 0; i <= 44; i++) {
    const a = (i / 44) * Math.PI * 2
    const r = 200 * (1 + 0.22 * Math.sin(a * 3))
    await m.move(760 + Math.cos(a) * r, 450 + Math.sin(a) * r * 0.8, { steps: 1 })
  }
  await m.up()
  await win.keyboard.up('Alt')
  await win.waitForTimeout(600)
  await shot('21-spot-lasso')
  const lasso = await win.evaluate(() => {
    const cv = document.querySelector('.veil-canvas')
    const ctx = cv.getContext('2d')
    const dpr = cv.width / window.innerWidth
    const at = (x, y) => ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3]
    return { centre: at(760, 450), bord: at(760, 450 - 158), dehors: at(120, 120) }
  })
  console.log('lasso — alpha centre :', lasso.centre, '· bord :', lasso.bord, '· hors zone :', lasso.dehors)
  ok(
    'lasso : trou au centre, dégradé au bord, voile ailleurs',
    lasso.centre < 30 && lasso.dehors > 120 && lasso.bord > lasso.centre && lasso.bord < lasso.dehors,
  )

  // la zone reste allumée SANS consommer une seule image
  await win.waitForTimeout(900)
  const dormant = await win.evaluate(
    () =>
      new Promise((res) => {
        const w = window
        if (!w.__origRaf) {
          w.__origRaf = w.requestAnimationFrame.bind(w)
          w.requestAnimationFrame = (cb) => {
            w.__raf++
            return w.__origRaf(cb)
          }
        }
        w.__raf = 0
        setTimeout(() => res(w.__raf), 1600)
      }),
  )
  console.log('images demandées pendant que le lasso reste allumé :', dormant)
  ok(`spotlight figé = boucle endormie (${dormant} images)`, dormant === 0)

  await m.move(600, 500)
  await m.down()
  await m.up()
  await win.waitForTimeout(400)
  await m.move(950, 320, { steps: 8 })
  await win.waitForTimeout(400)
  await shot('22-spot-retour-disque')
  const revenu = await win.evaluate(() => {
    const cv = document.querySelector('.veil-canvas')
    const ctx = cv.getContext('2d')
    const dpr = cv.width / window.innerWidth
    const at = (x, y) => ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3]
    return { sousCurseur: at(950, 320), ailleurs: at(300, 700) }
  })
  console.log('retour au disque suiveur :', JSON.stringify(revenu))
  ok('un simple clic rend la main au disque suiveur', revenu.sousCurseur < 30 && revenu.ailleurs > 120)

  await win.evaluate(() => document.querySelector('.toolbar button[title^="Pinceau"]').click())
  await win.waitForTimeout(700)
  const efface = await win.evaluate(() => {
    const cv = document.querySelector('.veil-canvas')
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 6) n++
    return n
  })
  ok(`voile entièrement retiré à la sortie de l'outil (${efface} pixels restants)`, efface === 0)
  await shot('23-spot-sorti')
}

/* ---------------- 6. RÈGLE D'OR : RIEN NE TOURNE AU REPOS ---------------- */
if (only === 'all' || only === 'idle') {
  console.log('\n=== 6. AU REPOS ===')
  await seed({
    gridMode: 'both',
    notes: [{ id: 'n1', x: 90, y: 130, text: 'Une note posée ne coûte pas une image.', color: '#39ff14' }],
    clocks: [{ id: 'c1', kind: 'chrono', x: 430, y: 130, elapsed: 92_400, startedAt: null, duration: 60_000 }],
    tool: 'pen',
  })
  await win.waitForTimeout(1600)
  await shot('24-repos-grille-note-chrono')
  // PREUVE : on compte les demandes d'image de l'APPLICATION elle-même.
  const compter = async (ms) => {
    await win.evaluate(() => {
      const w = window
      if (!w.__origRaf) {
        w.__origRaf = w.requestAnimationFrame.bind(w)
        w.requestAnimationFrame = (cb) => {
          w.__raf++
          return w.__origRaf(cb)
        }
      }
      w.__raf = 0
    })
    await win.waitForTimeout(ms)
    return win.evaluate(() => window.__raf)
  }
  const repos = await compter(2000)
  console.log("images demandées par l'application en 2 s, tout posé et rien en marche :", repos)
  ok(`aucune image au repos (${repos})`, repos === 0)
  const chiffres = await win.locator('.sw-digits').first().textContent()
  ok(`chrono à l'arrêt affiché correctement : ${chiffres}`, chiffres === '1:32.40')
  // et pendant qu'un chrono tourne, la boucle vit — puis se rendort
  await win.locator('.sw-btn.primary').first().click()
  const marche = await compter(1500)
  console.log('images demandées pendant que le chrono tourne :', marche)
  ok(`la boucle ne vit que pendant la marche (${marche} images)`, marche > 40)
  await win.locator('.sw-btn.primary').first().click() // pause
  await win.waitForTimeout(400)
  const rendormi = await compter(1500)
  console.log('images demandées après la pause :', rendormi)
  ok(`rendormi après la pause (${rendormi})`, rendormi === 0)
  await shot('25-repos-final')
}

/* ---------------- 7. RACCOURCIS CLAVIER ---------------- */
if (only === 'all' || only === 'clavier') {
  console.log('\n=== 7. RACCOURCIS CLAVIER ===')
  await seed({ clocks: [], notes: [], gridMode: 'off', tool: 'pen' })
  await win.keyboard.press('Control+Shift+G')
  await win.waitForTimeout(300)
  ok('Ctrl+Maj+G allume la grille', (await win.locator('.stage-grid').count()) === 1)
  await win.keyboard.press('Control+Shift+Y')
  await win.waitForTimeout(400)
  ok('Ctrl+Maj+Y pose un chrono', (await win.locator('.sw-clock').count()) === 1)
  await win.keyboard.press('Control+Shift+B')
  await win.waitForTimeout(400)
  ok('Ctrl+Maj+B pose une note', (await win.locator('.sw-note').count()) === 1)
  await shot('26-clavier')
  // et ces touches ne volent rien aux réflexes Epic Pen
  await win.keyboard.press('Control+Shift+3')
  await win.waitForTimeout(300)
  const outil = await win.evaluate(() => document.querySelector('.stage').dataset.tool)
  ok(`Ctrl+Maj+3 rend toujours le pinceau (${outil})`, outil === 'pen')
}

/* ---------------- 8. CLIC TRAVERSANT (le streamer joue) ---------------- */
if (only === 'all' || only === 'jeu') {
  console.log('\n=== 8. EN PLEINE PARTIE (clic traversant) ===')
  await seed({
    gridMode: 'thirds',
    notes: [{ id: 'n1', x: 90, y: 150, text: 'Plan : garder le contrôle du dragon.', color: '#ffe900' }],
    clocks: [{ id: 'c1', kind: 'countdown', x: 640, y: 130, elapsed: 0, startedAt: null, duration: 300_000 }],
    tool: 'pen',
  })
  await win.locator('.sw-btn.primary').first().click()
  await win.waitForTimeout(600)
  await win.keyboard.press('F8') // la souris repart au jeu
  await win.waitForTimeout(700)
  const etat = await win.evaluate(() => {
    const card = document.querySelector('.sw-clock')
    const note = document.querySelector('.sw-note')
    const layer = document.querySelector('.stage-widgets')
    const cs = (el) => getComputedStyle(el)
    return {
      traversant: document.body.classList.contains('passthrough'),
      carteVisible: cs(card).opacity,
      chiffres: card.querySelector('.sw-digits').textContent,
      noteVisible: cs(note).opacity,
      pointeur: cs(layer).pointerEvents,
      boutons: cs(card.querySelector('.sw-actions')).opacity,
      barre: cs(document.querySelector('.toolbar')).opacity,
    }
  })
  console.log('état :', JSON.stringify(etat))
  ok('la carte et la note restent VISIBLES pour le viewer', etat.carteVisible === '1' && etat.noteVisible === '1')
  ok('les commandes s’effacent, il ne reste que l’information', etat.boutons === '0' && etat.barre === '0')
  ok('la couche ne prend plus le pointeur', etat.pointeur === 'none')
  ok(`le compte à rebours tourne toujours (${etat.chiffres})`, etat.chiffres !== '5:00')
  await shot('27-clic-traversant')
}

console.log(`\nfenêtres : ${app.windows().length} · CASSÉ : ${casse}`)
await app.close()
console.log('--- terminé ---')
process.exit(casse === 0 ? 0 : 1)
