import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTIES, buildLandscape, computePoints, gauss, getDifficulty, hashString, rng,
  type Difficulty, type Vec3,
} from '../game/landscape';
import { GameCanvas, type Flight } from './GameCanvas';
import { fetchScores, rank, submitScore, usingFirebase } from '../lib/scores';
import { navigate } from '../lib/route';

const NAME_KEY = 'gdg.name';
const TUTORIAL_KEY = 'gdg.tutorialSeen';
const W_STEP = 0.5; // max change of the 4th parameter per shot

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function Game({ event }: { event: string }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [diffId, setDiffId] = useState<Difficulty['id'] | null>(null);
  const [round, setRound] = useState(0);

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

/** One idea per banner, surfaced during play instead of a single upfront wall of text. */
const TUTORIAL_TIPS: { icon: string; text: string }[] = [
  { icon: '🖱️', text: 'Drag on the map to shoot — how far you drag sets the learning rate.' },
  { icon: '➤', text: 'Follow the pulsing yellow arrow: the (noisy) −gradient, your best guess at downhill.' },
  { icon: '🌫️', text: "Fog hides the terrain — only spots you've actually visited stay revealed." },
];

function TutorialBanner({ index, onSkip }: { index: number; onSkip: () => void }) {
  const tip = TUTORIAL_TIPS[index];
  return (
    <div className="tip-banner" key={index}>
      <span className="tip-icon">{tip.icon}</span>
      <span className="tip-text">{tip.text}</span>
      <button className="tip-close" onClick={onSkip} aria-label="Dismiss tips">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------- round

function Round({ event, name, diff, onAgain, onMenu }: {
  event: string; name: string; diff: Difficulty; onAgain: () => void; onMenu: () => void;
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
  const dismissTutorial = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* ignore */ }
    setTutorialSeen(true);
  };

  const shotsTaken = path.length - 1;
  const done = (shotsTaken >= diff.shots || earlyStop) && !flight;
  // one tip per shot taken so far, then it retires itself for the rest of this device's rounds
  const tipIndex = !tutorialSeen && !done && shotsTaken < TUTORIAL_TIPS.length ? shotsTaken : -1;
  useEffect(() => {
    if (!tutorialSeen && shotsTaken >= TUTORIAL_TIPS.length) dismissTutorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotsTaken]);

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
    if (flight || shotsTaken >= diff.shots) return;
    setConfirmStop(false);
    window.clearTimeout(confirmTimer.current);
    const r = rng(hashString(`${seed}:l:${shotsTaken}`));
    const to: Vec3 = [
      clamp(cur[0] + step[0] + gauss(r) * diff.landNoise, -1, 1),
      clamp(cur[1] + step[1] + gauss(r) * diff.landNoise, -1, 1),
      ls.fourD ? clamp(wTarget + gauss(r) * diff.landNoise * 0.5, -1, 1) : 0,
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

  const zMin = Math.max(-1, cur[2] - W_STEP);
  const zMax = Math.min(1, cur[2] + W_STEP);
  const zHint = clamp(cur[2] - Math.sign(hint.gz) * Math.min(W_STEP, Math.abs(hint.gz) * 0.35), zMin, zMax);
  const pct = (v: number) => ((v - zMin) / (zMax - zMin || 1)) * 100;

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
      </div>

      {tipIndex >= 0 && <TutorialBanner index={tipIndex} onSkip={dismissTutorial} />}

      <div className="stats">
        <Stat label="Loss now" value={losses[losses.length - 1].toFixed(3)} />
        <Stat label="Best" value={Number.isFinite(bestLoss) ? bestLoss.toFixed(3) : '—'} accent />
        <Stat label="‖∇L‖" value={hint.mag.toFixed(2)} />
        {ls.fourD && <Stat label="w" value={cur[2].toFixed(2)} />}
      </div>

      <GameCanvas
        ls={ls}
        diff={diff}
        z={done ? cur[2] : wTarget}
        path={path}
        losses={losses}
        reveals={reveals}
        flight={flight}
        hintDir={hint.dir}
        autoAim={autoAim}
        disabled={done}
        revealAll={done}
        onShoot={onShoot}
        onLand={onLand}
      />

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
                  min={zMin}
                  max={zMax}
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
