import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTIES, buildLandscape, computePoints, gauss, getDifficulty, hashString, rng,
  type Difficulty, type Vec3,
} from '../game/landscape';
import { GameCanvas, type Flight } from './GameCanvas';
import { PALETTE_IDS, PALETTES, paletteSwatchCss, type PaletteId } from '../game/render';
import { fetchScores, rank, submitScore, usingFirebase } from '../lib/scores';
import { navigate } from '../lib/route';
import { useLang, type Dict } from '../lib/i18n';

const NAME_KEY = 'gdg.name';
const TUTORIAL_KEY = 'gdg.tutorialSeen';
const FOURD_KEY = 'gdg.tutorial4dSeen';
const THEME_KEY = 'gdg.theme';
const FULLSCREEN_KEY = 'gdg.fullscreen';
const W_STEP = 0.5; // max change of the 4th parameter per shot

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ----- browser Fullscreen API (with the webkit-prefixed variant older Safari/iPad still needs).
// Not every browser has it (notably iPhone Safari), so the immersive full-viewport layout is what
// actually makes the map big; real fullscreen just also hides the browser chrome where possible.
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fullscreenActive = () => {
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
};
function enterFullscreen() {
  const el = document.documentElement as FsEl;
  if (fullscreenActive()) return;
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* denied: layout still fills the viewport */ });
    else el.webkitRequestFullscreen?.();
  } catch { /* ignore */ }
}
function exitFullscreen() {
  const d = document as FsDoc;
  if (!fullscreenActive()) return;
  try {
    if (d.exitFullscreen) d.exitFullscreen().catch(() => { /* ignore */ });
    else d.webkitExitFullscreen?.();
  } catch { /* ignore */ }
}

const isPaletteId = (v: string | null): v is PaletteId => !!v && (PALETTE_IDS as string[]).includes(v);

export function Game({ event }: { event: string }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [diffId, setDiffId] = useState<Difficulty['id'] | null>(null);
  const [round, setRound] = useState(0);
  const [theme, setTheme] = useState<PaletteId>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return isPaletteId(v) ? v : 'sunset';
    } catch { return 'sunset'; }
  });
  const changeTheme = (t: PaletteId) => {
    setTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  };
  // full screen is the default: the map gets the whole viewport instead of a narrow column
  const [fullscreen, setFullscreen] = useState<boolean>(() => {
    try { return localStorage.getItem(FULLSCREEN_KEY) !== '0'; } catch { return true; }
  });
  // must run inside a click handler: browsers only grant fullscreen in response to a user gesture
  const toggleFullscreen = () => {
    const v = !fullscreen;
    setFullscreen(v);
    try { localStorage.setItem(FULLSCREEN_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    if (v) enterFullscreen(); else exitFullscreen();
  };
  // leaving the round (back to the menu, or navigating away) also leaves browser fullscreen
  useEffect(() => {
    if (!diffId) exitFullscreen();
  }, [diffId]);
  useEffect(() => () => exitFullscreen(), []);

  if (!diffId) {
    return (
      <Setup
        event={event}
        name={name}
        setName={setName}
        onStart={(d) => {
          localStorage.setItem(NAME_KEY, name.trim());
          if (fullscreen) enterFullscreen();
          setDiffId(d);
        }}
      />
    );
  }
  return (
    <Round
      key={`${diffId}-${round}`}
      event={event}
      name={name.trim()}
      diff={getDifficulty(diffId)}
      theme={theme}
      onThemeChange={changeTheme}
      fullscreen={fullscreen}
      onToggleFullscreen={toggleFullscreen}
      onAgain={() => setRound((r) => r + 1)}
      onMenu={() => setDiffId(null)}
    />
  );
}

// ---------------------------------------------------------------- setup

function Setup(props: {
  event: string;
  name: string;
  setName: (s: string) => void;
  onStart: (d: Difficulty['id']) => void;
}) {
  const { t } = useLang();
  const ok = props.name.trim().length > 0;
  return (
    <div className="page setup">
      <header className="setup-head">
        <div className="logo">⛳</div>
        <h1>Gradient Descent Golf</h1>
        <p className="lead">{t.setupLead}</p>
      </header>

      <label className="field">
        <span>{t.yourName}</span>
        <input
          value={props.name}
          maxLength={20}
          placeholder={t.namePlaceholder}
          autoComplete="off"
          onChange={(e) => props.setName(e.target.value)}
        />
      </label>

      <div className="diffs">
        {DIFFICULTIES.map((d) => (
          <button key={d.id} className={`diff ${d.id}`} disabled={!ok} onClick={() => props.onStart(d.id)}>
            <div className="diff-top">
              <b>{d.label}</b>
              <span className="mult">×{d.multiplier}</span>
            </div>
            <div className="diff-blurb">{t.diffBlurb[d.id]}</div>
            <div className="diff-meta">{t.shotsCount(d.shots)} · {d.fourD ? '4D' : '3D'}</div>
          </button>
        ))}
      </div>
      {!ok && <p className="muted center">{t.enterNameToPick}</p>}
      <div className="row gap-sm center">
        <button className="link" onClick={() => { try { localStorage.removeItem(TUTORIAL_KEY); } catch { /* ignore */ } }}>
          {t.showTipsNextRound}
        </button>
        <button className="link" onClick={() => navigate('/', props.event)}>{t.viewLeaderboard}</button>
      </div>
    </div>
  );
}

/**
 * One idea per card, all shown back-to-back before the round begins: each card blocks the game
 * until dismissed, then the next one appears immediately, with actual play starting only once
 * the whole sequence is dismissed. Tip 1 additionally renders a live colour-scale legend for the
 * current theme.
 */
function tutorialTips(t: Dict): { icon: string; text: string; also?: string; note?: string; legend?: boolean }[] {
  return [
    { icon: '🖐️', text: t.tipDrag },
    { icon: '🧭', text: t.tipOrbit },
    { icon: '🎯', legend: true, text: t.tipLegend, note: t.tipLegendNote },
    { icon: '➤', text: t.tipArrow },
    { icon: '🌫️', text: t.tipFog },
  ];
}

function TutorialOverlay({
  step, theme, onNext, onSkip,
}: { step: number; theme: PaletteId; onNext: () => void; onSkip: () => void }) {
  const { t } = useLang();
  const tips = tutorialTips(t);
  const tip = tips[step];
  const last = step === tips.length - 1;
  return (
    <div className="tip-backdrop" role="dialog" aria-modal="true">
      <div className="tip-card">
        <button className="tip-skip" onClick={onSkip} aria-label={t.tipSkipAria}>✕</button>
        <span className="tip-card-icon">{tip.icon}</span>
        <p className="tip-card-text">{tip.text}</p>
        {tip.also && <p className="tip-card-text">{tip.also}</p>}
        {tip.note && <p className="tip-card-note">{tip.note}</p>}
        {tip.legend && (
          <div className="tip-legend">
            <div className="tip-legend-bar" style={{ background: paletteSwatchCss(theme) }} />
            <div className="tip-legend-labels">
              <span className="good">{t.legendMin}</span>
              <span className="bad">{t.legendMax}</span>
            </div>
          </div>
        )}
        <div className="tip-dots">
          {tips.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <button className="btn primary" onClick={onNext}>{last ? t.tipGotIt : t.tipNext}</button>
      </div>
    </div>
  );
}

/** One-off, shown the first time a player opens a 4D difficulty — explains the w-slider. */
function FourDIntro({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useLang();
  return (
    <div className="tip-backdrop" role="dialog" aria-modal="true">
      <div className="tip-card">
        <button className="tip-skip" onClick={onDismiss} aria-label={t.dismissAria}>✕</button>
        <span className="tip-card-icon">🎚️</span>
        <p className="tip-card-text">{t.fourDPart1a} <b>w</b>{t.fourDPart1b}</p>
        <p className="tip-card-text">{t.fourDPart2}</p>
        <button className="btn primary" onClick={onDismiss}>{t.fourDGotIt}</button>
      </div>
    </div>
  );
}

function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg className="fs-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={exit
        ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
        : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
      />
    </svg>
  );
}

/** Lets players swap the heat-map colour scale for one that suits their colour vision. */
function ThemePicker({ theme, onChange }: { theme: PaletteId; onChange: (t: PaletteId) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className="theme-picker">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={t.changeColoursAria}>🎨</button>
      {open && (
        <>
          <div className="theme-backdrop" onClick={() => setOpen(false)} />
          <div className="theme-menu" role="menu">
            {PALETTE_IDS.map((id) => (
              <button
                key={id}
                className={`theme-option ${id === theme ? 'active' : ''}`}
                onClick={() => { onChange(id); setOpen(false); }}
              >
                <span className="theme-swatch" style={{ background: paletteSwatchCss(id) }} />
                <span className="theme-option-text">
                  <b>{PALETTES[id].name}</b>
                  <span className="muted small">{t.paletteBlurb[id]}</span>
                </span>
                {id === theme && <span className="theme-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- round

function Round({
  event, name, diff, theme, onThemeChange, fullscreen, onToggleFullscreen, onAgain, onMenu,
}: {
  event: string; name: string; diff: Difficulty; theme: PaletteId; onThemeChange: (t: PaletteId) => void;
  fullscreen: boolean; onToggleFullscreen: () => void;
  onAgain: () => void; onMenu: () => void;
}) {
  const { t } = useLang();
  // shared per-event course, unless the level asks for a never-seen-before map each round
  const [salt] = useState(() => (diff.randomMap ? `:${Math.random().toString(36).slice(2)}` : ''));
  const seed = `${event}:${diff.id}${salt}`;
  const ls = useMemo(() => buildLandscape(seed, diff), [seed, diff]);

  const [path, setPath] = useState<Vec3[]>(() => [ls.start]);
  const [losses, setLosses] = useState<number[]>(() => [ls.loss(...ls.start)]);
  const [reveals, setReveals] = useState<Vec3[]>(() => [ls.start]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [wTarget, setWTarget] = useState(ls.start[2]);
  // after the round, the revealed map can be browsed slice by slice; null = the ball's own slice
  const [recapW, setRecapW] = useState<number | null>(null);
  const [earlyStop, setEarlyStop] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const confirmTimer = useRef<number | undefined>(undefined);
  const [tutorialSeen, setTutorialSeen] = useState(() => {
    try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return true; }
  });
  const [fourDSeen, setFourDSeen] = useState(() => {
    try { return localStorage.getItem(FOURD_KEY) === '1'; } catch { return true; }
  });
  // shown once, before anything else, the first time a 4D difficulty is opened
  const fourDPending = diff.fourD && !fourDSeen;
  const dismissFourD = () => {
    try { localStorage.setItem(FOURD_KEY, '1'); } catch { /* ignore */ }
    setFourDSeen(true);
  };
  // the whole sequence blocks play up front, one card at a time, before the first shot
  const [dismissedCount, setDismissedCount] = useState(0);
  const dismissTutorial = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* ignore */ }
    setTutorialSeen(true);
  };

  const shotsTaken = path.length - 1;
  const done = (shotsTaken >= diff.shots || earlyStop) && !flight;
  const TIP_COUNT = 5;
  const tipShowing = !fourDPending && !tutorialSeen && !done && dismissedCount < TIP_COUNT;
  const blocked = fourDPending || tipShowing;
  const nextTip = () => {
    const n = dismissedCount + 1;
    setDismissedCount(n);
    if (n >= TIP_COUNT) dismissTutorial();
  };
  const skipTutorial = () => {
    setDismissedCount(TIP_COUNT);
    dismissTutorial();
  };
  // safety net: if the round ends mid-tutorial (e.g. an early finish), don't leave it dangling
  useEffect(() => {
    if (done && !tutorialSeen) dismissTutorial();
    if (done && fourDPending) dismissFourD();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const requestStop = () => {
    if (confirmStop) {
      window.clearTimeout(confirmTimer.current);
      setEarlyStop(true);
      return;
    }
    setConfirmStop(true);
    confirmTimer.current = window.setTimeout(() => setConfirmStop(false), 3000);
  };
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);
  const cur = path[path.length - 1];
  const bestLoss = Math.min(...losses.slice(1), Infinity);

  // noisy gradient at the current position (same for everyone on this course => fair)
  const hint = useMemo(() => {
    const g = ls.grad(...cur);
    const mag = Math.hypot(g[0], g[1], g[2]);
    const r = rng(hashString(`${seed}:g:${shotsTaken}`));
    const n = g.map((v) => v + diff.gradNoise * (mag * 0.7 + 0.15) * gauss(r)) as Vec3;
    const m2 = Math.hypot(n[0], n[1]) || 1;
    return { dir: [-n[0] / m2, -n[1] / m2] as [number, number], gz: n[2], mag: Math.hypot(...n) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ls, shotsTaken]);

  const onShoot = (step: [number, number]) => {
    if (flight || shotsTaken >= diff.shots || blocked) return;
    setConfirmStop(false);
    window.clearTimeout(confirmTimer.current);
    const r = rng(hashString(`${seed}:l:${shotsTaken}`));
    const to: Vec3 = [
      clamp(cur[0] + step[0] + gauss(r) * diff.landNoise, -1, 1),
      clamp(cur[1] + step[1] + gauss(r) * diff.landNoise, -1, 1),
      // w is a deliberate, precise slider choice — unlike x/y it isn't subject to landing noise,
      // so it only ever changes when the player actually moves the slider
      ls.fourD ? clamp(wTarget, -1, 1) : 0,
    ];
    setFlight({ from: cur, to, t0: performance.now() });
  };

  const onLand = () => {
    if (!flight) return;
    const { from, to } = flight;
    setPath((p) => [...p, to]);
    setLosses((l) => [...l, ls.loss(...to)]);
    const extra: Vec3[] = [0.25, 0.5, 0.75, 1].map((t) => [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]);
    setReveals((rv) => [...rv, ...extra]);
    setWTarget(to[2]);
    setFlight(null);
    navigator.vibrate?.(25);
  };

  const points = done ? computePoints(ls, diff, losses[0], bestLoss) : 0;

  // ---- publish once
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [myRank, setMyRank] = useState<{ pos: number; total: number } | null>(null);
  const sent = useRef(false);
  const send = async () => {
    setStatus('sending');
    try {
      await submitScore({
        name, points, loss: Number(bestLoss.toFixed(4)), difficulty: diff.id, shots: diff.shots, event,
      });
      setStatus('ok');
      const board = rank(await fetchScores(event));
      const pos = board.findIndex((e) => e.name.trim().toLowerCase() === name.toLowerCase());
      if (pos >= 0) setMyRank({ pos: pos + 1, total: board.length });
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };
  useEffect(() => {
    if (done && !sent.current) {
      sent.current = true;
      void send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const shownPoints = useCountUp(points, done);

  // the w-axis' own bounds are fixed for the whole round (not a window around the current
  // position), so the slider track doesn't visually re-centre itself after every shot
  const zHint = clamp(cur[2] - Math.sign(hint.gz) * Math.min(W_STEP, Math.abs(hint.gz) * 0.35), -1, 1);
  const pct = (v: number) => ((v + 1) / 2) * 100;

  return (
    <div className="page play">
      <div className="stage">
        <GameCanvas
          ls={ls}
          diff={diff}
          theme={theme}
          t={t}
          z={done ? recapW ?? cur[2] : wTarget}
          path={path}
          losses={losses}
          reveals={reveals}
          flight={flight}
          hintDir={hint.dir}
          disabled={done || blocked}
          revealAll={done}
          onShoot={onShoot}
          onLand={onLand}
        />

        <div className="hud-top">
          <div className="row">
            <button className="icon-btn" onClick={onMenu} aria-label={t.backAria}>←</button>
            <div className="title">
              <b>{diff.label}</b>
              <span className="muted">{name}</span>
            </div>
            <div className="shots" aria-label={t.shotsLeftAria(diff.shots - shotsTaken)}>
              {Array.from({ length: diff.shots }, (_, i) => (
                <i key={i} className={i < shotsTaken ? 'used' : ''} />
              ))}
            </div>
            <ThemePicker theme={theme} onChange={onThemeChange} />
            <button
              className="icon-btn"
              onClick={onToggleFullscreen}
              aria-label={fullscreen ? t.exitFullscreenAria : t.enterFullscreenAria}
              aria-pressed={fullscreen}
              title={fullscreen ? t.exitFullscreenAria : t.enterFullscreenAria}
            >
              <FullscreenIcon exit={fullscreen} />
            </button>
          </div>
          <div className="hud-stats">
            <span>{t.statLossNow} <b>{losses[losses.length - 1].toFixed(3)}</b></span>
            <span className="accent">{t.statBest} <b>{Number.isFinite(bestLoss) ? bestLoss.toFixed(3) : '—'}</b></span>
            <span>‖∇L‖ <b>{hint.mag.toFixed(2)}</b></span>
            {ls.fourD && <span>w <b>{cur[2].toFixed(2)}</b></span>}
          </div>
        </div>

        {fourDPending ? (
          <FourDIntro onDismiss={dismissFourD} />
        ) : (
          tipShowing && <TutorialOverlay step={dismissedCount} theme={theme} onNext={nextTip} onSkip={skipTutorial} />
        )}

        {!done ? (
          <div className="hud-bottom">
            {ls.fourD && (
              <div className="slider">
                <div className="slider-label">
                  <span>{t.fourthDimLabel} <b>w</b> → {wTarget.toFixed(2)}</span>
                  <button className="chip" onClick={() => setWTarget(zHint)}>{t.useGrad}</button>
                </div>
                <div className="slider-track">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={wTarget}
                    disabled={!!flight}
                    onChange={(e) => setWTarget(Number(e.target.value))}
                  />
                  <span className="tick now" style={{ left: `${pct(cur[2])}%` }} title="current" />
                  <span className="tick hint" style={{ left: `${pct(zHint)}%` }} title="gradient hint" />
                </div>
              </div>
            )}
            <div className="row center">
              <span className="muted small">
                {shotsTaken === 0 ? t.dragToShootHint : t.shotsLeftText(diff.shots - shotsTaken)}
              </span>
            </div>
            {shotsTaken > 0 && (
              <button className={`stop-btn ${confirmStop ? 'confirm' : ''}`} onClick={requestStop}>
                {confirmStop ? t.tapAgainBtn : t.finishRoundBtn}
              </button>
            )}
          </div>
        ) : (
          <div className="hud-bottom result">
            <div className="result-points">
              <span className="big">{shownPoints}</span> <span className="muted">{t.pointsWord}</span>
            </div>
            <div className="muted">
              {t.bestLossPrefix} <b>{bestLoss.toFixed(3)}</b> · {t.globalMinPrefix} <b>{ls.lo.toFixed(3)}</b>
              {earlyStop && shotsTaken < diff.shots && (
                <> · {t.finishedEarly(shotsTaken, diff.shots)}</>
              )}
            </div>
            {ls.fourD && (
              <div className="slider recap-slider">
                <div className="slider-label">
                  <span>{t.exploreWLabel}: <b>w</b> = {(recapW ?? cur[2]).toFixed(2)}</span>
                  <span className="row gap-sm">
                    <button className="chip" onClick={() => setRecapW(null)}>{t.yourWBtn}</button>
                    <button className="chip goal" onClick={() => setRecapW(ls.best[2])}>{t.goalWBtn}</button>
                  </span>
                </div>
                <div className="slider-track">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={recapW ?? cur[2]}
                    onChange={(e) => setRecapW(Number(e.target.value))}
                  />
                  <span className="tick now" style={{ left: `${pct(cur[2])}%` }} title={t.yourWBtn} />
                  <span className="tick goal" style={{ left: `${pct(ls.best[2])}%` }} title={t.goalWBtn} />
                </div>
              </div>
            )}
            <div className={`status ${status}`}>
              {status === 'sending' && t.publishing}
              {status === 'ok' && (myRank ? t.publishedRank(myRank.pos, myRank.total) : t.publishedNoRank)}
              {status === 'error' && (
                <>{t.publishFailed} <button className="chip" onClick={() => void send()}>{t.retryBtn}</button></>
              )}
              {status === 'ok' && !usingFirebase && <div className="small muted">{t.demoModeNote}</div>}
            </div>
            <div className="row gap">
              <button className="btn primary" onClick={onAgain}>{t.playAgainBtn}</button>
              <button className="btn" onClick={onMenu}>{t.changeLevelBtn}</button>
              <button className="btn" onClick={() => navigate('/', event)}>{t.leaderboardBtn}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function useCountUp(target: number, active: boolean) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 1100);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return v;
}
