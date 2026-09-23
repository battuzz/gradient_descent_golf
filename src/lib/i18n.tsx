import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'it' | 'en';

const LANG_KEY = 'gdg.lang';

export const LANGS: { id: Lang; flag: string; code: string }[] = [
  { id: 'it', flag: '🇮🇹', code: 'IT' },
  { id: 'en', flag: '🇬🇧', code: 'EN' },
];

export interface Dict {
  // ---- leaderboard / landing page
  tagline: string;
  live: string;
  scanToPlay: string;
  roundsPlayed: string;
  players: string;
  loading: string;
  noScoresYet: string;
  couldNotLoadBoard: string;
  demoModeBadge: string;
  eventPrefix: string;
  eventSet: string;
  playHereInstead: string;
  copyLink: string;
  tickerScored: (name: string, points: number, diff: string) => string;

  // ---- setup screen
  setupLead: string;
  yourName: string;
  namePlaceholder: string;
  enterNameToPick: string;
  showTipsNextRound: string;
  viewLeaderboard: string;
  shotsCount: (n: number) => string;

  diffBlurb: Record<'easy' | 'medium' | 'hard', string>;
  paletteBlurb: Record<'sunset' | 'viridis' | 'cividis' | 'iceFire', string>;

  // ---- tutorial cards
  tipDrag: string;
  tipLegend: string;
  tipLegendNote: string;
  tipArrow: string;
  tipArrowAlso: string;
  tipFog: string;
  tipNext: string;
  tipGotIt: string;
  tipSkipAria: string;
  legendMin: string;
  legendMax: string;

  fourDPart1a: string;
  fourDPart1b: string;
  fourDPart2: string;
  fourDGotIt: string;
  dismissAria: string;

  // ---- theme picker / colour bar
  changeColoursAria: string;
  colorBarAria: string;
  toggle3DAria: string;
  camControlsAria: string;
  rotateLeftAria: string;
  rotateRightAria: string;
  zoomInAria: string;
  zoomOutAria: string;
  resetViewAria: string;
  dragToPanHint: string;
  panModeBadge: string;
  enterFullscreenAria: string;
  exitFullscreenAria: string;

  // ---- round HUD
  backAria: string;
  statLossNow: string;
  statBest: string;
  fourthDimLabel: string;
  useGrad: string;
  autoAimToggle: string;
  dragToShootHint: string;
  shotsLeftText: (n: number) => string;
  shotsLeftAria: (n: number) => string;
  finishRoundBtn: string;
  tapAgainBtn: string;

  // ---- result screen
  pointsWord: string;
  bestLossPrefix: string;
  globalMinPrefix: string;
  finishedEarly: (used: number, total: number) => string;
  publishing: string;
  publishedRank: (pos: number, total: number) => string;
  publishedNoRank: string;
  publishFailed: string;
  retryBtn: string;
  demoModeNote: string;
  playAgainBtn: string;
  changeLevelBtn: string;
  leaderboardBtn: string;
  lossPerStep: string;

  // ---- canvas-drawn labels
  previewingLabel: (v: string) => string;
  goalAtLabel: (v: string) => string;
}

const en: Dict = {
  tagline: 'Beat the machine. Find the minimum. Claim the top spot.',
  live: 'LIVE',
  scanToPlay: 'Scan to play',
  roundsPlayed: 'rounds played',
  players: 'players',
  loading: 'Loading…',
  noScoresYet: 'No scores yet — be the first!',
  couldNotLoadBoard: 'Could not load the leaderboard.',
  demoModeBadge: 'Demo mode — scores stay on this device only',
  eventPrefix: 'Event',
  eventSet: 'Set',
  playHereInstead: 'Play here instead →',
  copyLink: 'Copy link',
  tickerScored: (name, points, diff) => `🏌️ ${name} scored ${points} pts on ${diff}`,

  setupLead: 'You are the optimizer. Roll the ball downhill on a hidden loss landscape and find the deepest '
    + 'valley before you run out of steps.',
  yourName: 'Your name',
  namePlaceholder: 'e.g. Ada Lovelace',
  enterNameToPick: 'Enter a name to pick a difficulty',
  showTipsNextRound: '❔ Show tips next round',
  viewLeaderboard: 'View leaderboard →',
  shotsCount: (n) => `${n} shots`,

  diffBlurb: {
    easy: 'One smooth valley, exact gradient — just follow the arrow downhill.',
    medium: 'Bumpy terrain, noisy gradient, half the view, speckled.',
    hard: 'A hidden 4th dimension, tiny and sparsely-sampled view.',
  },
  paletteBlurb: {
    sunset: 'Default — high-contrast, most colourful',
    viridis: 'Colour-blind friendly (red-green safe)',
    cividis: 'Optimised for colour vision deficiency',
    iceFire: 'Blue/orange — max contrast, no red-green',
  },

  tipDrag: 'Drag on the map to shoot — how far you drag sets the learning rate.',
  tipLegend: "This is the loss. Bright means good, dark means bad — aim for the brightest colour, that's the minimum!",
  tipLegendNote: 'You can customize the theme with the 🎨 in the top right.',
  tipArrow: 'Follow the pulsing yellow arrow: the (noisy) −gradient, your best guess at downhill.',
  tipArrowAlso: 'Prefer to aim it yourself? Turn off Auto-aim.',
  tipFog: "Your information is limited — fog hides everything you haven't explored. Roam around to find the minimum!",
  tipNext: 'Next',
  tipGotIt: "Got it — let's golf",
  tipSkipAria: 'Skip tips',
  legendMin: '★ minimum',
  legendMax: 'high loss',

  fourDPart1a: 'This level hides a 4th dimension,',
  fourDPart1b: ". Drag the slider below the map to choose where you'll land along it.",
  fourDPart2: 'The white mark shows where you are now; the yellow mark shows where the gradient suggests moving.',
  fourDGotIt: 'Got it',
  dismissAria: 'Dismiss',

  changeColoursAria: 'Change heat-map colours',
  colorBarAria: 'Colour scale from highest loss (worst) at the top to lowest loss (best) at the bottom',
  toggle3DAria: 'Switch between flat heat-map and 3D relief view',
  camControlsAria: '3D camera controls',
  rotateLeftAria: 'Rotate view left',
  rotateRightAria: 'Rotate view right',
  zoomInAria: 'Zoom in',
  zoomOutAria: 'Zoom out',
  resetViewAria: 'Reset 3D view',
  dragToPanHint: 'Drag to rotate the view · pinch or scroll to zoom',
  panModeBadge: 'Pan & zoom mode',
  enterFullscreenAria: 'Play in full screen',
  exitFullscreenAria: 'Exit full screen',

  backAria: 'Back',
  statLossNow: 'Loss now',
  statBest: 'Best',
  fourthDimLabel: '4th dimension',
  useGrad: 'use ∇',
  autoAimToggle: 'Auto-aim −∇',
  dragToShootHint: 'Drag on the map to shoot',
  shotsLeftText: (n) => `${n} shots left`,
  shotsLeftAria: (n) => `${n} shots left`,
  finishRoundBtn: "I've found it — finish round",
  tapAgainBtn: 'Tap again to lock it in',

  pointsWord: 'points',
  bestLossPrefix: 'best loss',
  globalMinPrefix: 'global minimum',
  finishedEarly: (used, total) => `finished early (${used}/${total} shots used)`,
  publishing: 'Publishing your score…',
  publishedRank: (pos, total) => `Published! You are #${pos} of ${total} on the leaderboard 🎉`,
  publishedNoRank: 'Published to the leaderboard 🎉',
  publishFailed: 'Could not publish.',
  retryBtn: 'Retry',
  demoModeNote: '(demo mode: stored only in this browser)',
  playAgainBtn: 'Play again',
  changeLevelBtn: 'Change level',
  leaderboardBtn: 'Leaderboard',
  lossPerStep: 'loss per step',

  previewingLabel: (v) => `previewing w = ${v}`,
  goalAtLabel: (v) => `goal at w=${v}`,
};

const it: Dict = {
  tagline: 'Batti la macchina. Trova il minimo. Conquista la vetta.',
  live: 'LIVE',
  scanToPlay: 'Inquadra per giocare',
  roundsPlayed: 'partite giocate',
  players: 'giocatori',
  loading: 'Caricamento…',
  noScoresYet: 'Ancora nessun punteggio — sii il primo!',
  couldNotLoadBoard: 'Impossibile caricare la classifica.',
  demoModeBadge: 'Modalità demo — i punteggi restano solo su questo dispositivo',
  eventPrefix: 'Evento',
  eventSet: 'Imposta',
  playHereInstead: 'Gioca qui invece →',
  copyLink: 'Copia link',
  tickerScored: (name, points, diff) => `🏌️ ${name} ha segnato ${points} pt su ${diff}`,

  setupLead: 'Vesti i panni di un ottimizzatore. Scegli come muoverti e trova il punto più basso prima di '
    + 'esaurire i tiri.',
  yourName: 'Il tuo nome',
  namePlaceholder: 'es. Ada Lovelace',
  enterNameToPick: 'Inserisci un nome per scegliere la difficoltà',
  showTipsNextRound: '❔ Mostra i suggerimenti al prossimo turno',
  viewLeaderboard: 'Vedi classifica →',
  shotsCount: (n) => `${n} tiri`,

  diffBlurb: {
    easy: 'Una valle liscia, gradiente esatto — segui semplicemente la freccia in discesa.',
    medium: 'Terreno accidentato, gradiente rumoroso, metà visuale, a chiazze.',
    hard: 'Una quarta dimensione nascosta, visuale minuscola e a campionamento sparso.',
  },
  paletteBlurb: {
    sunset: 'Predefinito — alto contrasto, più colorato',
    viridis: 'Adatto ai daltonici (sicuro per rosso-verde)',
    cividis: 'Ottimizzato per il deficit della visione dei colori',
    iceFire: 'Blu/arancione — massimo contrasto, niente rosso-verde',
  },

  tipDrag: 'Trascina sulla mappa per tirare — quanto trascini imposta il learning rate.',
  tipLegend: 'Questa è la loss. Chiaro è buono, scuro è cattivo — punta al colore più chiaro: quello è il minimo!',
  tipLegendNote: 'Puoi personalizzare il tema con il 🎨 in alto a destra.',
  tipArrow: 'Segui la freccia gialla pulsante: il (rumoroso) −gradiente, la tua miglior stima della discesa.',
  tipArrowAlso: 'Preferisci mirare da solo? Disattiva la Mira automatica.',
  tipFog: 'Le tue informazioni sono limitate — la nebbia nasconde tutto ciò che non hai esplorato. '
    + 'Esplora per trovare il minimo!',
  tipNext: 'Avanti',
  tipGotIt: 'Capito — si gioca!',
  tipSkipAria: 'Salta i suggerimenti',
  legendMin: '★ minimo',
  legendMax: 'loss alta',

  fourDPart1a: 'Questo livello nasconde una quarta dimensione,',
  fourDPart1b: '. Trascina lo slider sotto la mappa per scegliere dove atterrare lungo questa dimensione.',
  fourDPart2: 'Il segno bianco mostra dove ti trovi ora; il segno giallo mostra dove il gradiente suggerisce di muoversi.',
  fourDGotIt: 'Capito',
  dismissAria: 'Chiudi',

  changeColoursAria: 'Cambia i colori della mappa',
  colorBarAria: 'Scala colori: loss più alta (peggiore) in alto, loss più bassa (migliore) in basso',
  toggle3DAria: 'Passa dalla mappa termica piatta alla vista in rilievo 3D',
  camControlsAria: 'Controlli della fotocamera 3D',
  rotateLeftAria: 'Ruota la vista a sinistra',
  rotateRightAria: 'Ruota la vista a destra',
  zoomInAria: 'Aumenta lo zoom',
  zoomOutAria: 'Riduci lo zoom',
  resetViewAria: 'Ripristina la vista 3D',
  dragToPanHint: 'Trascina per ruotare la vista · pizzica o scorri per zoomare',
  panModeBadge: 'Modalità pan e zoom',
  enterFullscreenAria: 'Gioca a schermo intero',
  exitFullscreenAria: 'Esci dallo schermo intero',

  backAria: 'Indietro',
  statLossNow: 'Loss attuale',
  statBest: 'Migliore',
  fourthDimLabel: '4ª dimensione',
  useGrad: 'usa ∇',
  autoAimToggle: 'Mira automatica −∇',
  dragToShootHint: 'Trascina sulla mappa per tirare',
  shotsLeftText: (n) => `${n} tiri rimasti`,
  shotsLeftAria: (n) => `${n} tiri rimasti`,
  finishRoundBtn: 'Ho trovato il minimo — termina il turno',
  tapAgainBtn: 'Tocca di nuovo per confermare',

  pointsWord: 'punti',
  bestLossPrefix: 'loss migliore',
  globalMinPrefix: 'minimo globale',
  finishedEarly: (used, total) => `terminato in anticipo (${used}/${total} tiri usati)`,
  publishing: 'Pubblicazione del punteggio…',
  publishedRank: (pos, total) => `Pubblicato! Sei #${pos} su ${total} in classifica 🎉`,
  publishedNoRank: 'Pubblicato in classifica 🎉',
  publishFailed: 'Pubblicazione non riuscita.',
  retryBtn: 'Riprova',
  demoModeNote: '(modalità demo: salvato solo su questo browser)',
  playAgainBtn: 'Gioca ancora',
  changeLevelBtn: 'Cambia livello',
  leaderboardBtn: 'Classifica',
  lossPerStep: 'loss per tiro',

  previewingLabel: (v) => `anteprima w = ${v}`,
  goalAtLabel: (v) => `obiettivo a w=${v}`,
};

const DICTS: Record<Lang, Dict> = { en, it };

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
}

const Ctx = createContext<LangCtx | null>(null);

function readInitialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' ? 'en' : 'it'; // default: Italian
  } catch {
    return 'it';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ lang, setLang, t: DICTS[lang] }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLang must be used within a LangProvider');
  return ctx;
}
