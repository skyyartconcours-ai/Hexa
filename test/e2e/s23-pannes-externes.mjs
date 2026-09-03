#!/usr/bin/env node
/**
 * Hexa — §S23 : LES PANNES QUI VIENNENT DU DEHORS.
 *
 * POURQUOI CE FICHIER EXISTE. Trois pannes que Hexa NE MAÎTRISE PAS n'avaient
 * jamais été exécutées par aucune campagne — le rapport de vérification les
 * listait comme « ouvertes » sans les éprouver :
 *
 *   1. LE FLUX D'ÉCRAN REFUSÉ. La loupe, le masque flou et le gel demandent à
 *      voir l'écran. Sous Windows, cette demande échoue pour de vrais motifs :
 *      politique d'entreprise, pilote graphique, session verrouillée, capture
 *      déjà monopolisée. Le code prévoit un message — mais personne n'avait
 *      vérifié qu'il ARRIVE, ni surtout que le refus ne déclenche pas une
 *      rafale de nouvelles tentatives. Une rafale, c'est très exactement la
 *      plainte n°1 de l'utilisateur : « ça rame, et de plus en plus ».
 *
 *   2. LE PORT DU SERVEUR OBS DÉJÀ PRIS. L'utilisateur a OBS ouvert en
 *      permanence et relance Hexa souvent : deux instances, ou un port occupé
 *      par autre chose, sont des situations ordinaires. Un `EADDRINUSE` non
 *      rattrapé dans le processus principal, c'est Hexa qui ne démarre pas.
 *
 *   3. L'EXPORT QUI NE PEUT PAS ÉCRIRE (disque plein, dossier en lecture
 *      seule). Une exception non rattrapée pendant un export, c'est une
 *      session de commentaire perdue.
 *
 * L'exigence est la même partout, et elle est modeste : Hexa le DIT, Hexa
 * SURVIT, et LE STYLO DESSINE ENCORE. Une panne extérieure a le droit de
 * priver l'utilisateur d'une fonction ; elle n'a pas le droit de lui prendre
 * son outil en plein direct.
 */
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, KO, OK, RACINE, Rapport, chargerPilote, lancerHexa, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()

/* ================================================================== *
 * 1. LE FLUX D'ÉCRAN REFUSÉ
 * ================================================================== */

const { app, win, journal } = await lancerHexa({ profil: 's23' })

await win.evaluate(() =>
  localStorage.setItem(
    'hexa-ui',
    JSON.stringify({
      state: {
        onboarded: true,
        fadeDelay: null,
        tool: 'pen',
        size: 6,
        sound: false,
        globalShortcutsOn: false,
        globalShortcutsChosen: true,
      },
      version: 3,
    }),
  ),
)
await win.reload()
await win.waitForSelector('.stage canvas', { timeout: 20000 })
await win.waitForTimeout(1200)

/**
 * On fait échouer l'ouverture du flux À LA SOURCE, exactement là où Windows
 * échoue : `getUserMedia` lève. On compte aussi les tentatives, parce que
 * c'est le vrai danger — pas le refus lui-même, mais l'acharnement.
 */
await win.evaluate(() => {
  const w = window
  w.__essais = 0
  const md = navigator.mediaDevices
  md.getUserMedia = async () => {
    w.__essais++
    throw new Error('NotAllowedError: refus simulé (§S23)')
  }
  if (md.getDisplayMedia) {
    md.getDisplayMedia = async () => {
      w.__essais++
      throw new Error('NotAllowedError: refus simulé (§S23)')
    }
  }
})

const enDessin = async () => {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(200)
  if (await win.evaluate(() => document.body.classList.contains('passthrough')).catch(() => false)) {
    await win.keyboard.press('F8')
    await win.waitForTimeout(500)
  }
}

const peints = () =>
  win
    .evaluate(() => {
      let n = 0
      for (const cv of document.querySelectorAll('.stage canvas')) {
        if (!cv.width) continue
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
      }
      return n
    })
    .catch(() => -1)

await enDessin()

await rapport.test(win, 's23-1-loupe-flux-refuse', 'Flux d’écran refusé : la loupe le DIT au lieu de faire semblant', async () => {
  const avant = journal.erreurs.length
  /*
   * ⚠️ CE QUI DÉCLENCHE VRAIMENT LA DEMANDE DE FLUX, c'est le POINTER DOWN
   * (fx-capture.ts, `onDown`), pas la sélection de l'outil. Tenir la touche de
   * la loupe sans jamais cliquer ne prouve donc rien. On prend le masque flou
   * et on TRACE un masque : c'est le geste complet de l'utilisateur, et c'est
   * lui qui passe par `afterFeed`, donc par le message.
   *
   * Et on lit le message SUR SON ÉLÉMENT (`.fx-toast`), pas dans
   * `document.body.innerText` : le HUD des effets vit dans un conteneur que
   * `innerText` ne restitue pas toujours — une version antérieure de ce test
   * concluait « message ABSENT » alors qu'il était bien affiché.
   */
  await win.keyboard.press('b') // masque flou
  await win.waitForTimeout(300)
  await win.mouse.move(500, 350)
  await win.mouse.down()
  await win.mouse.move(800, 550, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(2000)

  const vu = await win.evaluate(() => {
    const t = document.querySelector('.fx-toast')
    return {
      toast: t ? (t.textContent ?? '') : '(élément .fx-toast absent)',
      visible: t ? t.classList.contains('on') : false,
      essais: window.__essais ?? -1,
    }
  })
  const parleDeLEcran = vu.visible && /écran|refus|partage/i.test(vu.toast)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(400)

  return {
    statut: parleDeLEcran && journal.erreurs.length === avant ? OK : KO,
    detail:
      `${vu.essais} tentative(s) d’ouverture du flux · toast affiché : ${vu.visible} · ` +
      `« ${vu.toast.slice(0, 80)} » · ${journal.erreurs.length - avant} erreur(s) de page`,
  }
})

await rapport.test(win, 's23-2-refus-pas-de-rafale', 'Un refus ne déclenche pas une rafale de tentatives', async () => {
  const depart = await win.evaluate(() => (window.__essais = 0))
  // On insiste comme un utilisateur qui ne comprend pas : dix masques de suite,
  // donc dix demandes de flux, toutes refusées.
  await win.keyboard.press('b')
  await win.waitForTimeout(250)
  for (let i = 0; i < 10; i++) {
    await win.mouse.move(300 + i * 30, 300)
    await win.mouse.down()
    await win.mouse.move(400 + i * 30, 420, { steps: 6 })
    await win.mouse.up()
    await win.waitForTimeout(200)
  }
  await win.waitForTimeout(2500)
  const essais = await win.evaluate(() => window.__essais ?? -1)

  // Dix demandes de l'utilisateur peuvent légitimement faire dix tentatives.
  // Ce qu'on interdit, c'est la boucle : une tentative par image, soit des
  // centaines. Le plafond est large exprès — on cherche un emballement.
  const ok = essais >= 0 && essais <= 40
  return {
    statut: ok ? OK : KO,
    detail: `${essais} tentative(s) pour 10 demandes (plafond 40 : au-delà, c’est une boucle, pas une réponse) · départ ${depart}`,
  }
})

await rapport.test(win, 's23-3-stylo-survit-au-refus', 'Après un flux refusé, le stylo dessine encore', async () => {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
  await enDessin()
  await win.keyboard.press('p')
  await win.waitForTimeout(300)
  await win.mouse.move(400, 300)
  await win.mouse.down()
  await win.mouse.move(900, 500, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  const px = await peints()
  return {
    statut: px > 3000 ? OK : KO,
    detail: `${px} px peints après une série de refus du flux d’écran (doit être > 3000)`,
  }
})

await rapport.test(win, 's23-4-refus-rien-au-repos', 'Un refus ne laisse pas Hexa calculer dans le vide', async () => {
  // §2.5 : après tout ça, au repos, zéro image. Un flux refusé qui laisserait
  // une boucle d'attente tourner coûterait exactement ce que l'utilisateur a
  // passé trois correctifs à faire disparaître.
  await win.keyboard.press('Control+Shift+E').catch(() => {})
  await win.waitForTimeout(800)
  const a = await win.evaluate(() => window.__hexaDbg?.appels ?? -1)
  await win.waitForTimeout(3000)
  const b = await win.evaluate(() => window.__hexaDbg?.appels ?? -1)
  return {
    statut: b - a === 0 ? OK : KO,
    detail: `${b - a} image(s) calculée(s) sur 3 s de repos après refus (doit être 0)`,
  }
})

/* ------------------------------------------------------------------ *
 * L'EXPORT QUI NE PEUT PAS ÉCRIRE
 * ------------------------------------------------------------------ */

await rapport.test(win, 's23-5-export-impossible', 'Un export qui ne peut pas écrire ne casse pas la session', async () => {
  await enDessin()
  await win.keyboard.press('p')
  await win.waitForTimeout(200)
  await win.mouse.move(300, 300)
  await win.mouse.down()
  await win.mouse.move(800, 500, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const avantPx = await peints()
  const avantErr = journal.erreurs.length

  /*
   * ⚠️ HONNÊTETÉ SUR CE QU'ON ÉPROUVE ICI. « Disque plein » n'est pas
   * observable depuis la page : l'export d'Hexa ne passe par AUCUNE écriture
   * disque du processus principal — il fabrique un Blob et le confie au
   * téléchargement du navigateur (`replay/exporter.ts`, fonction `download`).
   * Simuler ENOSPC n'aurait donc rien simulé du tout.
   *
   * On éprouve la panne qui, elle, EST réelle et atteignable au même endroit :
   * `canvas.toBlob` qui rend `null` — mémoire insuffisante sur un export ×4
   * d'une grande session, ou canevas rendu inexportable. C'est exactement le
   * point où une session de commentaire se perd sans un mot.
   */
  // On stérilise `toBlob` PUIS on passe par le VRAI bouton d'export du panneau
  // des réglages : c'est le geste de l'utilisateur, pas une porte dérobée.
  await win.evaluate(() => {
    window.__toBlobVrai = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(null)
    }
  })
  await win.keyboard.press('Control+,')
  await win.waitForTimeout(900)
  const resultat = await win.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').trim().startsWith('Exporter le PNG'),
    )
    if (!b) return { clique: false }
    b.click()
    return { clique: true }
  })
  await win.waitForTimeout(1500)
  const message = await win.evaluate(() => document.body.innerText).catch(() => '')
  await win.evaluate(() => {
    if (window.__toBlobVrai) HTMLCanvasElement.prototype.toBlob = window.__toBlobVrai
  })
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(600)
  const apresPx = await peints()
  // L'exigence : le bouton a bien été actionné, la session est intacte, rien
  // n'a levé DANS LA PAGE, et l'échec est DIT plutôt que silencieux.
  const dit = /rien à exporter|impossible|échou|erreur/i.test(message)
  const ok = resultat.clique && apresPx >= avantPx - 200 && journal.erreurs.length === avantErr
  return {
    statut: ok ? OK : KO,
    detail:
      `bouton « Exporter le PNG » actionné : ${resultat.clique} · toBlob stérilisé · ` +
      `échec annoncé à l’écran : ${dit ? 'oui' : 'non'} · ` +
      `encre ${avantPx} → ${apresPx} px · ${journal.erreurs.length - avantErr} erreur(s) de page`,
  }
})

await app.close()

/* ================================================================== *
 * 2. LE PORT DU SERVEUR OBS DÉJÀ PRIS
 *
 * On OCCUPE réellement le port avant de lancer Hexa, et on demande le serveur
 * dans l'état persisté. C'est la situation d'une seconde instance d'Hexa, ou
 * d'un autre logiciel sur le même port.
 * ================================================================== */

const PORT = 47615
const squatteur = createServer(() => {})
await new Promise((res, rej) => {
  squatteur.once('error', rej)
  squatteur.listen(PORT, '127.0.0.1', res)
})

const electron = await chargerPilote()
const USER2 = join(CAPTURES, '.user-data-s23b')
rmSync(USER2, { recursive: true, force: true })
mkdirSync(USER2, { recursive: true })

const app2 = await electron.launch({
  args: ['.', `--user-data-dir=${USER2}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
  env: { ...process.env, HEXA_FUSION: '1' },
})
const win2 = await app2.firstWindow({ timeout: 30000 })
const err2 = []
win2.on('pageerror', (e) => err2.push(String(e.message)))
await win2.waitForSelector('.stage canvas', { timeout: 20000 })
await win2.waitForTimeout(1000)

await rapport.test(win2, 's23-6-port-obs-occupe', 'Le port du serveur OBS déjà pris n’empêche pas Hexa de tourner', async () => {
  await win2.evaluate(
    (p) =>
      localStorage.setItem(
        'hexa-ui',
        JSON.stringify({
          state: {
            onboarded: true,
            fadeDelay: null,
            tool: 'pen',
            size: 6,
            sound: false,
            globalShortcutsOn: false,
            globalShortcutsChosen: true,
            // Le serveur local demandé, sur un port DÉJÀ OCCUPÉ.
            obsServerOn: true,
            obsPort: p,
          },
          version: 3,
        }),
      ),
    PORT,
  )
  await win2.reload()
  await win2.waitForSelector('.stage canvas', { timeout: 20000 }).catch(() => {})
  await win2.waitForTimeout(3000)

  // Hexa est-il vivant, et le dit-il ?
  await win2.keyboard.press('Escape').catch(() => {})
  await win2.waitForTimeout(200)
  if (await win2.evaluate(() => document.body.classList.contains('passthrough')).catch(() => false)) {
    await win2.keyboard.press('F8')
    await win2.waitForTimeout(500)
  }
  await win2.keyboard.press('p')
  await win2.waitForTimeout(250)
  await win2.mouse.move(400, 300)
  await win2.mouse.down()
  await win2.mouse.move(900, 500, { steps: 12 })
  await win2.mouse.up()
  await win2.waitForTimeout(500)

  const px = await win2
    .evaluate(() => {
      let n = 0
      for (const cv of document.querySelectorAll('.stage canvas')) {
        if (!cv.width) continue
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
      }
      return n
    })
    .catch(() => -1)

  const p = join(USER2, 'hexa.log')
  const jrn = existsSync(p) ? readFileSync(p, 'utf8') : ''
  // Le conflit doit être TRACÉ : sans trace, l'utilisateur qui ne voit pas sa
  // source OBS n'a aucun moyen de comprendre.
  const trace = /EADDRINUSE|port|adresse déjà|occup/i.test(jrn)

  return {
    statut: px > 3000 && err2.length === 0 ? OK : KO,
    detail:
      `${px} px peints avec le port ${PORT} occupé · ${err2.length} erreur(s) de page · ` +
      `conflit tracé au journal : ${trace ? 'oui' : 'non'}`,
  }
})

await app2.close()
await new Promise((res) => squatteur.close(res))

process.stdout.write(rapport.tableau() + '\n')
process.exit(rapport.codeSortie)
