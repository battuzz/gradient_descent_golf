import { firebaseConfig, firebaseConfigured } from './firebaseConfig';

export interface ScoreEntry {
  id: string;
  name: string;
  points: number;
  loss: number;
  difficulty: string;
  shots: number;
  event: string;
  ts: number;
}

export type NewScore = Omit<ScoreEntry, 'id' | 'ts'>;

export const usingFirebase = firebaseConfigured;

const COLLECTION = 'scores';
const LOCAL_KEY = 'gdg.local.scores';

// Firebase is loaded lazily so the game screen stays snappy.
let fb: Promise<{
  db: import('firebase/firestore').Firestore;
  m: typeof import('firebase/firestore');
}> | null = null;

function getFb() {
  if (!fb) {
    fb = (async () => {
      const [{ initializeApp }, m] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
      const app = initializeApp(firebaseConfig);
      return { db: m.getFirestore(app), m };
    })();
  }
  return fb;
}

function readLocal(): ScoreEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export async function submitScore(s: NewScore): Promise<void> {
  if (!firebaseConfigured) {
    const all = readLocal();
    all.push({ ...s, id: crypto.randomUUID(), ts: Date.now() });
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all.slice(-500)));
    return;
  }
  const { db, m } = await getFb();
  await m.addDoc(m.collection(db, COLLECTION), { ...s, createdAt: m.serverTimestamp() });
}

export async function fetchScores(event: string): Promise<ScoreEntry[]> {
  if (!firebaseConfigured) return readLocal().filter((e) => e.event === event);
  const { db, m } = await getFb();
  // single equality filter => no composite index needed
  const snap = await m.getDocs(m.query(m.collection(db, COLLECTION), m.where('event', '==', event)));
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      name: String(v.name ?? '?'),
      points: Number(v.points ?? 0),
      loss: Number(v.loss ?? 0),
      difficulty: String(v.difficulty ?? 'easy'),
      shots: Number(v.shots ?? 0),
      event: String(v.event ?? ''),
      ts: v.createdAt?.toMillis?.() ?? 0,
    };
  });
}

/** One row per player (their best round), best first. */
export function rank(entries: ScoreEntry[]): ScoreEntry[] {
  const best = new Map<string, ScoreEntry>();
  for (const e of entries) {
    const k = e.name.trim().toLowerCase();
    const cur = best.get(k);
    if (!cur || e.points > cur.points || (e.points === cur.points && e.ts < cur.ts)) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.points - a.points || a.ts - b.ts);
}
