import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchScores, rank, usingFirebase, type ScoreEntry } from '../lib/scores';
import { getDifficulty } from '../game/landscape';
import { DEFAULT_EVENT, navigate, playUrl, setStoredEvent } from '../lib/route';

const POLL_MS = 4000;
const MEDALS = ['🥇', '🥈', '🥉'];

export function Leaderboard({ event }: { event: string }) {
  const [entries, setEntries] = useState<ScoreEntry[] | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const prevTop = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number;
    const poll = async () => {
      try {
        const list = rank(await fetchScores(event));
        if (!alive) return;
        setEntries(list);
        setErr(false);
        const top = list[0]?.id ?? null;
        if (prevTop.current && top && top !== prevTop.current) {
          setFlash(true);
          setTimeout(() => setFlash(false), 1200);
        }
        prevTop.current = top;
      } catch (e) {
        console.error(e);
        if (alive) setErr(true);
      } finally {
        if (alive) timer = window.setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [event]);

  const url = playUrl(event);

  return (
    <div className="page board">
      <header className="board-head">
        <div className="logo">⛳</div>
        <h1>Gradient Descent Golf</h1>
        <p className="lead">Scan to play on your phone. The board updates live.</p>
      </header>

      <div className="board-grid">
        <div className="qr-card">
          <QRCodeSVG value={url} size={220} bgColor="transparent" fgColor="#eef4ff" level="M" includeMargin={false} />
          <button className="url" onClick={() => navigator.clipboard?.writeText(url).catch(() => {})} title="Copy link">
            {url.replace(/^https?:\/\//, '')}
          </button>
          {editing ? (
            <EventEditor event={event} onDone={() => setEditing(false)} />
          ) : (
            <button className="chip" onClick={() => setEditing(true)}>Event: {event} ✎</button>
          )}
          {!usingFirebase && <div className="badge warn">Demo mode — scores stay on this device only</div>}
        </div>

        <div className={`list-card ${flash ? 'flash' : ''}`}>
          {err && <div className="badge error">Could not load the leaderboard.</div>}
          {!entries ? (
            <div className="muted center pad">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="muted center pad">No scores yet — be the first!</div>
          ) : (
            <ol className="rows">
              {entries.map((e, i) => (
                <li key={e.id} className={i < 3 ? 'top' : ''}>
                  <span className="pos">{MEDALS[i] ?? i + 1}</span>
                  <span className="who">
                    <b>{e.name}</b>
                    <span className="tag">{getDifficulty(e.difficulty).label}</span>
                  </span>
                  <span className="pts">{e.points}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <button className="link" onClick={() => navigate('/play', event)}>Play here instead →</button>
    </div>
  );
}

function EventEditor({ event, onDone }: { event: string; onDone: () => void }) {
  const [v, setV] = useState(event);
  const apply = () => {
    const next = v.trim() || DEFAULT_EVENT;
    setStoredEvent(next);
    onDone();
  };
  return (
    <div className="row gap-sm">
      <input className="ev-input" value={v} maxLength={40} onChange={(e) => setV(e.target.value)} />
      <button className="chip" onClick={apply}>Set</button>
    </div>
  );
}
