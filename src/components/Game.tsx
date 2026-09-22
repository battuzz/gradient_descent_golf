import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTIES, buildLandscape, computePoints, gauss, getDifficulty, hashString, rng,
  type Difficulty, type Vec3,
} from '../game/landscape';
import { GameCanvas, type Flight } from './GameCanvas';
import { PALETTE_IDS, PALETTES, paletteSwatchCss, type PaletteId } from '../game/render';
import { fetchScores, rank, submitScore, usingFirebase } from '../lib/scores';
import { navigate } from '../lib/route';

const NAME_KEY = 'gdg.name';
const TUTORIAL_KEY = 'gdg.tutorialSeen';
const FOURD_KEY = 'gdg.tutorial4dSeen';
const THEME_KEY = 'gdg.theme';
const W_STEP = 0.5; // max change of the 4th parameter per shot

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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

  if (!diffId) {
    return (
      <Setup
        event={event}
        name={name}
        setName={setName}
        onStart={(d) => {
          localStorage.setItem(NAME_KEY, name.trim());
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
  const ok = props.name.trim().length > 0;
  return (
    <div className="page setup">
      <header className="setup-head">
        <div className="logo">⛳</div>
        <h1>Gradient Descent Golf</h1>
        <p className="lead">
          You are the optimizer. Roll the ball downhill on a hidden loss landscape and find the deepest valley
          before you run out of steps.
        </p>
      </header>

      <label className="field">
        <span>Your name</span>
        <input
          value={props.name}
          maxLength={20}
          placeholder="e.g. Ada Lovelace"
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
            <div className="diff-blurb">{d.blurb}</div>
            <div className="diff-meta">{d.shots} shots{d.fourD ? ' · 4D' : ' · 3D'}</div>
          </button>
        ))}
      </div>
      {!ok && <p className="muted center">Enter a name to pick a difficulty</p>}
      <div className="row gap-sm center">
        <button className="link" onClick={() => { try { localStorage.removeItem(TUTORIAL_KEY); } catch { /* ignore */ } }}>
          ❔ Show tips next round
        </button>
        <button className="link" onClick={() => navigate('/', props.event)}>View leaderboard →</button>
      </div>
    </div>
  );
}

/**
 * One idea per card, interleaved with actual play: a card blocks the game until dismissed,
 * then the player takes the shot it just taught them, then the next card appears. Tip 1
 * additionally renders a live colour-scale legend for the current theme.
 */
const TUTORIAL_TIPS: { icon: string; text: string; also?: string; note?: string; legend?: boolean }[] = [
  { icon: '🖱️', text: 'Drag on the map to shoot — how far you drag sets the learning rate.' },
  {
    icon: '🎯', legend: true,
    text: "This is the loss. Bright means good, dark means bad — aim for the brightest colour, that's the minimum!",
    note: 'You can customize the theme with the 🎨 in the top right.',
  },
  {
    icon: '➤',
    text: 'Follow the pulsing yellow arrow: the (noisy) −gradient, your best guess at downhill.',
    also: 'Prefer to aim it yourself? Turn off Auto-aim.',
  },
  {
    icon: '🌫️',
    text: "Your information is limited — fog hides everything you haven't explored. Roam around to find the minimum!",
  },
];

function TutorialOverlay({
  step, theme, onNext, onSkip,
}: { step: number; theme: PaletteId; onNext: () => void; onSkip: () => void }) {
  const tip = TUTORIAL_TIPS[step];
  const last = step === TUTORIAL_TIPS.length - 1;
  return (
    <div className="tip-backdrop" role="dialog" aria-modal="true">
      <div className="tip-card">
        <button className="tip-skip" onClick={onSkip} aria-label="Skip tips">✕</button>
        <span className="tip-card-icon">{tip.icon}</span>
        <p className="tip-card-text">{tip.text}</p>
        {tip.also && <p className="tip-card-text">{tip.also}</p>}
        {tip.note && <p className="tip-card-note">{tip.note}</p>}
        {tip.legend && (
          <div className="tip-legend">
            <div className="tip-legend-bar" style={{ background: paletteSwatchCss(theme) }} />
            <div className="tip-legend-labels">
              <span className="good">★ minimum</span>
              <span className="bad">high loss</span>
            </div>
          </div>
        )}
        <div className="tip-dots">
          {TUTORIAL_TIPS.map((_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <button className="btn primary" onClick={onNext}>{last ? "Got it — let's golf" : 'Next'}</button>
      </div>
    </div>
  );
}

/** One-off, shown the first time a player opens a 4D difficulty — explains the w-slider. */
function FourDIntro({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="tip-backdrop" role="dialog" aria-modal="true">
      <div className="tip-card">
        <button className="tip-skip" onClick={onDismiss} aria-label="Dismiss">✕</button>
        <span className="tip-card-icon">🎚️</span>
        <p className="tip-card-text">
          This level hides a 4th dimension, <b>w</b>. Drag the slider below the map to choose where you'll land
          along it.
        </p>
        <p className="tip-card-text">
          The white mark shows where you are now; the yellow mark shows where the gradient suggests moving.
        </p>
        <button className="btn primary" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

/** Persistent legend beside the map: which colour is the minimum, which is the worst, and the
 *  actual loss values at each end — so the heat-map never has to be read by memory alone. */
function ColorBar({ theme, lo, hi }: { theme: PaletteId; lo: number; hi: number }) {
  return (
    <div className="color-bar">
      <div className="color-bar-end">
        <span className="color-bar-tag">max</span>
        <span className="color-bar-value">{hi.toFixed(2)}</span>
      </div>
      <div
        className="color-bar-track"
        style={{ background: paletteSwatchCss(theme, 0) }}
        role="img"
        aria-label="Colour scale from highest loss (worst) at the top to lowest loss (best) at the bottom"
      />
      <div className="color-bar-end">
        <span className="color-bar-tag">min</span>
        <span className="color-bar-value">{lo.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** Lets players swap the heat-map colour scale for one that suits their colour vision. */
function ThemePicker({ theme, onChange }: { theme: PaletteId; onChange: (t: PaletteId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="theme-picker">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Change heat-map colours">🎨</button>
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
                  <span className="muted small">{PALETTES[id].blurb}</span>
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

function Round({ event, name, diff, theme, onThemeChange, onAgain, onMenu }: {
  event: string; name: string; diff: Difficulty; theme: PaletteId; onThemeChange: (t: PaletteId) => void;
  onAgain: () => void; onMenu: () => void;
}) {
  const seed = `${event}:${diff.id}`;
  const ls = useMemo(() => buildLandscape(seed, diff), [seed, diff]);

  const [path, setPath] = useState<Vec3[]>(() => [ls.start]);
  const [losses, setLosses] = useState<number[]>(() => [ls.loss(...ls.start)]);
  const [reveals, setReveals] = useState<Vec3[]>(() => [ls.start]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [wTarget, setWTarget] = useState(ls.start[2]);
  const [autoAim, setAutoAim] = useState(diff.autoAim);
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
  // one card per shot taken so far: card[n] blocks play until dismissed, then shot n happens,
  // which is what reveals card[n+1] — teaching by having them immediately do the thing just shown
  const [dismissedCount, setDismissedCount] = useState(0);
  const dismissTutorial = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* ignore */ }
    setTutorialSeen(true);
  };

  const shotsTaken = path.length - 1;
  const done = (shotsTaken >= diff.shots || earlyStop) && !flight;
  const tipShowing =
    !fourDPending && !tutorialSeen && !done && dismissedCount < TUTORIAL_TIPS.length && shotsTaken === dismissedCount;
  const blocked = fourDPending || tipShowing;
  const nextTip = () => {
    const n = dismissedCount + 1;
    setDismissedCount(n);
    if (n >= TUTORIAL_TIPS.length) dismissTutorial();
  };
  const skipTutorial = () => {
    setDismissedCount(TUTORIAL_TIPS.length);
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
      <div className="topbar">
        <button className="icon-btn" onClick={onMenu} aria-label="Back">←</button>
        <div className="title">
          <b>{diff.label}</b>
          <span className="muted">{name}</span>
        </div>
        <div className="shots" aria-label={`${diff.shots - shotsTaken} shots left`}>
          {Array.from({ length: diff.shots }, (_, i) => (
            <i key={i} className={i < shotsTaken ? 'used' : ''} />
          ))}
        </div>
        <ThemePicker theme={theme} onChange={onThemeChange} />
      </div>

      <div className="stats">
        <Stat label="Loss now" value={losses[losses.length - 1].toFixed(3)} />
        <Stat label="Best" value={Number.isFinite(bestLoss) ? bestLoss.toFixed(3) : '—'} accent />
        <Stat label="‖∇L‖" value={hint.mag.toFixed(2)} />
        {ls.fourD && <Stat label="w" value={cur[2].toFixed(2)} />}
      </div>

      <div className="canvas-row">
        <GameCanvas
          ls={ls}
          diff={diff}
          theme={theme}
          z={done ? cur[2] : wTarget}
          path={path}
          losses={losses}
          reveals={reveals}
          flight={flight}
          hintDir={hint.dir}
          autoAim={autoAim}
          disabled={done || blocked}
          revealAll={done}
          onShoot={onShoot}
          onLand={onLand}
        />
        <ColorBar theme={theme} lo={ls.lo} hi={ls.hi} />
      </div>

      {fourDPending ? (
        <FourDIntro onDismiss={dismissFourD} />
      ) : (
        tipShowing && <TutorialOverlay step={dismissedCount} theme={theme} onNext={nextTip} onSkip={skipTutorial} />
      )}

      {!done ? (
        <div className="controls">
          <Sparkline losses={losses} lo={ls.lo} hi={ls.hi} />
          {ls.fourD && (
            <div className="slider">
              <div className="slider-label">
                <span>4th dimension <b>w</b> → {wTarget.toFixed(2)}</span>
                <button className="chip" onClick={() => setWTarget(zHint)}>use ∇</button>
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
          <div className="row">
            <button className={`toggle ${autoAim ? 'on' : ''}`} onClick={() => setAutoAim((a) => !a)}>
              <span className="knob" /> Auto-aim −∇
            </button>
            <span className="muted small">
              {shotsTaken === 0 ? 'Drag on the map to shoot' : `${diff.shots - shotsTaken} shots left`}
            </span>
          </div>
          {shotsTaken > 0 && (
            <button className={`stop-btn ${confirmStop ? 'confirm' : ''}`} onClick={requestStop}>
              {confirmStop ? 'Tap again to lock it in' : "I've found it — finish round"}
            </button>
          )}
        </div>
      ) : (
        <div className="result">
          <div className="result-points">
            <span className="big">{shownPoints}</span> <span className="muted">points</span>
          </div>
          <div className="muted">
            best loss <b>{bestLoss.toFixed(3)}</b> · global minimum <b>{ls.lo.toFixed(3)}</b>
            {earlyStop && shotsTaken < diff.shots && (
              <> · finished early ({shotsTaken}/{diff.shots} shots used)</>
            )}
          </div>
          <div className={`status ${status}`}>
            {status === 'sending' && 'Publishing your score…'}
            {status === 'ok' &&
              (myRank ? `Published! You are #${myRank.pos} of ${myRank.total} on the leaderboard 🎉` : 'Published to the leaderboard 🎉')}
            {status === 'error' && (
              <>Could not publish. <button className="chip" onClick={() => void send()}>Retry</button></>
            )}
            {status === 'ok' && !usingFirebase && <div className="small muted">(demo mode: stored only in this browser)</div>}
          </div>
          <div className="row gap">
            <button className="btn primary" onClick={onAgain}>Play again</button>
            <button className="btn" onClick={onMenu}>Change level</button>
            <button className="btn" onClick={() => navigate('/', event)}>Leaderboard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Sparkline({ losses, lo, hi }: { losses: number[]; lo: number; hi: number }) {
  const W = 300;
  const H = 40;
  const n = Math.max(losses.length, 2);
  const pts = losses.map((v, i) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return `${(i / (n - 1)) * W},${4 + t * (H - 8)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <text x="4" y="12" className="spark-t">loss per step</text>
    </svg>
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
