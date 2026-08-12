/**
 * Hexa — bandeau d'accueil natif (petite fenêtre éphémère, façon notification).
 *
 * Pourquoi une fenêtre séparée plutôt qu'un message dans l'interface React :
 * ce bandeau doit s'afficher MÊME SI le renderer ne se charge pas. C'est la
 * preuve visuelle que « Hexa tourne », et c'est exactement ce qui manquait quand
 * l'utilisateur lançait l'application et ne voyait rien du tout.
 *
 * Contraintes respectées : aucune ressource externe (tout est en ligne dans un
 * `data:` URL), jamais de focus volé, clics traversants, fermeture automatique,
 * aucune animation qui survit à la fenêtre.
 */
import { BrowserWindow, screen } from 'electron'
import { logError } from './logger'

/** Fenêtre unique : un deuxième message remplace le premier. */
let toast: BrowserWindow | null = null
/** Minuterie de fermeture (setTimeout à un coup, jamais setInterval). */
let timer: NodeJS.Timeout | null = null

/**
 * Le bandeau part-il dans les captures ? NON par défaut (§S11) : il s'adresse
 * au streamer, jamais à ses spectateurs. Suit le même réglage que la fenêtre
 * d'interface — « Masquer l'interface de Hexa dans les captures ».
 */
let protectionCapture = true

/** Aligne le bandeau sur le réglage de protection de capture. */
export function setToastProtection(on: boolean): void {
  protectionCapture = on
  try {
    if (toast && !toast.isDestroyed()) toast.setContentProtection(on)
  } catch {
    /* plateforme sans protection de contenu */
  }
}

const LARGEUR = 460
const HAUTEUR = 132

function page(titre: string, texte: string, dureeMs: number): string {
  // La durée de l'animation CSS colle à la durée de vie de la fenêtre : quand la
  // fenêtre disparaît, plus rien ne tourne. Aucune animation infinie.
  const sortie = Math.max(200, dureeMs - 420)
  return `<!doctype html><meta charset="utf-8"><title>Hexa</title>
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    -webkit-user-select:none;user-select:none;cursor:default}
  .carte{
    box-sizing:border-box;margin:8px;height:calc(100% - 16px);
    display:flex;align-items:center;gap:14px;padding:16px 18px;
    border-radius:16px;
    background:linear-gradient(135deg,rgba(13,16,28,.94),rgba(20,14,34,.94));
    border:1px solid rgba(120,220,255,.28);
    box-shadow:0 18px 48px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.35),
      inset 0 1px 0 rgba(255,255,255,.06);
    color:#eaf6ff;font:14px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
    animation:entree .42s cubic-bezier(.16,1,.3,1) both, sortie .4s ease-in ${sortie}ms both;
  }
  .marque{flex:0 0 auto;width:40px;height:40px;filter:drop-shadow(0 0 10px rgba(0,229,255,.55))}
  .titre{font-weight:650;font-size:15px;letter-spacing:.2px;
    background:linear-gradient(90deg,#7ef0ff,#b98cff);-webkit-background-clip:text;
    background-clip:text;color:transparent}
  .texte{margin-top:3px;color:#b9c6da;font-size:12.5px}
  kbd{display:inline-block;padding:1px 6px;border-radius:6px;font:inherit;font-size:11.5px;
    background:rgba(126,240,255,.14);border:1px solid rgba(126,240,255,.32);color:#d6f7ff}
  @keyframes entree{from{opacity:0;transform:translateY(14px) scale(.97)}
    to{opacity:1;transform:none}}
  @keyframes sortie{from{opacity:1}to{opacity:0;transform:translateY(6px)}}
</style>
<div class="carte">
  <svg class="marque" viewBox="0 0 48 48" aria-hidden>
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#31d9ff"/><stop offset="1" stop-color="#a855f7"/>
    </linearGradient></defs>
    <path d="M24 3l18 10.5v21L24 45 6 34.5v-21z" fill="url(#g)"/>
    <path d="M24 8.5l13.2 7.7v15.6L24 39.5l-13.2-7.7V16.2z" fill="#0b0e17"/>
    <path d="M16 32c4-11 10-14 16-18" fill="none" stroke="#7ef0ff" stroke-width="3.2"
      stroke-linecap="round"/>
    <circle cx="32.6" cy="13.4" r="3.1" fill="#fff"/>
  </svg>
  <div>
    <div class="titre">${titre}</div>
    <div class="texte">${texte}</div>
  </div>
</div>`
}

/**
 * Affiche un message éphémère en bas à droite de l'écran principal.
 * `texte` peut contenir des `<kbd>` pour les touches.
 */
export function showToast(titre: string, texte: string, dureeMs = 5200): void {
  try {
    closeToast()
    const zone = screen.getPrimaryDisplay().workArea
    toast = new BrowserWindow({
      width: LARGEUR,
      height: HAUTEUR,
      x: zone.x + zone.width - LARGEUR - 16,
      y: zone.y + zone.height - HAUTEUR - 16,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      // Ne vole JAMAIS le focus : l'utilisateur est peut-être en pleine partie.
      focusable: false,
      show: false,
      roundedCorners: false,
      title: 'Hexa',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: false,
      },
    })
    toast.setAlwaysOnTop(true, 'screen-saver')
    toast.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Purement informatif : les clics vont au jeu, comme si rien n'était là.
    toast.setIgnoreMouseEvents(true, { forward: false })
    toast.setMenuBarVisibility(false)
    /**
     * §S11 — CE BANDEAU NE DOIT JAMAIS PARTIR DANS LE DIRECT.
     *
     * C'est lui qui annonçait « Hexa se met en retrait — tes clics repartent
     * dans ton jeu » au beau milieu du stream : un message adressé au streamer,
     * que ses spectateurs recevaient en pleine figure. Comme la fenêtre
     * d'interface, il est donc exclu des captures (WDA_EXCLUDEFROMCAPTURE sous
     * Windows). Il reste parfaitement visible sur l'écran de l'utilisateur, et
     * s'efface tout seul au bout de quelques secondes.
     */
    if (protectionCapture) {
      try {
        toast.setContentProtection(true)
      } catch {
        /* plateforme sans protection de contenu : le bandeau reste visible */
      }
    }

    const fenetre = toast
    fenetre.once('ready-to-show', () => {
      try {
        if (!fenetre.isDestroyed()) fenetre.showInactive()
      } catch {
        /* ignore */
      }
    })
    fenetre.on('closed', () => {
      if (toast === fenetre) toast = null
    })

    void fenetre
      .loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(page(titre, texte, dureeMs)),
      )
      .catch((err: unknown) => {
        // Cas normal et fréquent : un second message est arrivé pendant le
        // chargement du premier, qui a donc été détruit en cours de route. Ce
        // n'est pas une panne, ça n'a rien à faire dans le journal.
        if (fenetre.isDestroyed()) return
        logError('accueil', 'chargement du bandeau impossible', err)
      })

    timer = setTimeout(() => {
      timer = null
      closeToast()
    }, dureeMs)
  } catch (err) {
    logError('accueil', 'bandeau impossible à afficher', err)
  }
}

/** Ferme le bandeau et libère sa minuterie (appelé aussi à la fermeture). */
export function closeToast(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const fenetre = toast
  toast = null
  try {
    if (fenetre && !fenetre.isDestroyed()) fenetre.destroy()
  } catch {
    /* ignore */
  }
}
