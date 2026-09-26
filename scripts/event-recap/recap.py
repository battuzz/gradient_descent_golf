#!/usr/bin/env python3
"""End-of-event recap: pull every round of an event from Firestore, print a per-player summary
and render a shareable 1080x1350 "Hall of Fame" PNG praising the 3 players with the most rounds.

    python3 scripts/event-recap/recap.py ndr2026 [--lang en|it] [--out recaps/ndr2026]

The praise line under each podium player is picked from that player's own stats relative to the
whole event (see `praise_candidates`), so the card adapts to how each event actually went.
Reads need no credentials: firestore.rules allows public reads of `scores`.
"""
import argparse
import collections
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PROJECT = 'gradientdescentgolf'  # public: it ships in the site's JS bundle
LEVEL_ORDER = ['easy', 'medium', 'hard', 'extreme']

TEXT = {
    'en': {
        'title': 'Hall of <span>Fame</span>',
        'sub': 'The most dedicated gradient descenders of {event}',
        'rounds_unit': 'rounds',
        'foot': '<b>{rounds}</b> rounds · <b>{players}</b> players',
        'thanks': '⛳ Thanks for descending with us!',
        'levels': {'easy': 'Easy', 'medium': 'Medium', 'hard': 'Hard', 'extreme': 'Extreme'},
        'marathon': ('The marathon descender', '{share}% of all rounds played'),
        'all_levels': ('The all-rounder', 'conquered all {n} levels'),
        'top_score': ('Sharpest shot', 'top score: {best}'),
        'specialist': ('{level} addict', '{n} rounds on {level}'),
        'consistent': ('Rock solid', 'avg {avg} points per round'),
        'improver': ('Getting sharper', '+{gain}% from first to last rounds'),
        'fallback': ('Never gave up', 'best score: {best}'),
    },
    'it': {
        'title': 'Hall of <span>Fame</span>',
        'sub': 'I discesisti del gradiente più instancabili di {event}',
        'rounds_unit': 'partite',
        'foot': '<b>{rounds}</b> partite · <b>{players}</b> giocatori',
        'thanks': '⛳ Grazie per essere scesi con noi!',
        'levels': {'easy': 'Facile', 'medium': 'Medio', 'hard': 'Difficile', 'extreme': 'Estremo'},
        'marathon': ('Il maratoneta della discesa', '{share}% di tutte le partite'),
        'all_levels': ('Il tuttofare', 'ha conquistato tutti i {n} livelli'),
        'top_score': ('Il colpo più preciso', 'punteggio record: {best}'),
        'specialist': ('Fan del livello {level}', '{n} partite a {level}'),
        'consistent': ('Solido come una roccia', 'media di {avg} punti a partita'),
        'improver': ('Sempre più preciso', '+{gain}% dalle prime alle ultime partite'),
        'fallback': ('Mai arreso', 'miglior punteggio: {best}'),
    },
}


def fetch_rounds(project: str, event: str) -> list[dict]:
    url = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents:runQuery'
    body = json.dumps({'structuredQuery': {
        'from': [{'collectionId': 'scores'}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'event'}, 'op': 'EQUAL', 'value': {'stringValue': event}}},
    }}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    rounds = []
    for item in data:
        f = item.get('document', {}).get('fields')
        if not f:
            continue
        val = lambda k, d=None: next(iter(f[k].values())) if k in f else d  # noqa: E731
        rounds.append({
            'name': str(val('name', '?')).strip(),
            'points': float(val('points', 0)),
            'difficulty': str(val('difficulty', 'easy')),
            'ts': str(val('createdAt', '')),
        })
    return rounds


def summarize(rounds: list[dict]) -> list[dict]:
    """One entry per player (names merged case-insensitively, like the leaderboard)."""
    by = collections.defaultdict(list)
    for r in rounds:
        by[r['name'].lower()].append(r)
    players = []
    for rs in by.values():
        rs.sort(key=lambda r: r['ts'])
        pts = [r['points'] for r in rs]
        players.append({
            'name': collections.Counter(r['name'] for r in rs).most_common(1)[0][0],
            'games': len(rs),
            'best': max(pts),
            'avg': sum(pts) / len(pts),
            'levels': collections.Counter(r['difficulty'] for r in rs),
            'points': pts,
        })
    # most rounds first; ties go to the better best score
    players.sort(key=lambda p: (-p['games'], -p['best'], p['name'].lower()))
    return players


def praise_candidates(p: dict, rank: int, ctx: dict) -> list[tuple[str, dict]]:
    """(kind, format args) in order of preference; the first kind not taken by a higher-ranked
    podium player is used, so the three captions never repeat."""
    out = []
    if rank == 0:
        out.append(('marathon', {'share': round(100 * p['games'] / ctx['rounds'])}))
    if p['best'] >= ctx['top_best']:
        out.append(('top_score', {'best': int(p['best'])}))
    if len(ctx['levels']) > 1 and set(ctx['levels']) <= set(p['levels']):
        out.append(('all_levels', {'n': len(ctx['levels'])}))
    lvl, n = p['levels'].most_common(1)[0]
    if n >= 3 and n / p['games'] >= 0.6 and len(ctx['levels']) > 1:
        out.append(('specialist', {'level': ctx['t']['levels'].get(lvl, lvl), 'n': n}))
    if p['avg'] >= ctx['podium_best_avg'] and p['games'] >= 3:
        out.append(('consistent', {'avg': round(p['avg'])}))
    k = min(5, p['games'] // 2)
    if k >= 2:
        first, last = sum(p['points'][:k]) / k, sum(p['points'][-k:]) / k
        if first > 0 and last / first >= 1.2:
            out.append(('improver', {'gain': round(100 * (last / first - 1))}))
    out.append(('fallback', {'best': int(p['best'])}))
    return out


def pick_praise(top: list[dict], ctx: dict) -> list[tuple[str, str]]:
    taken, lines = set(), []
    for i, p in enumerate(top):
        for kind, args in praise_candidates(p, i, ctx):
            if kind not in taken or kind == 'fallback':
                taken.add(kind)
                head, detail = ctx['t'][kind]
                lines.append((head.format(**args), detail.format(**args)))
                break
    return lines


def render_html(event: str, top: list[dict], praise: list[tuple[str, str]], ctx: dict) -> str:
    t = ctx['t']
    medals = ['🏆', '🥈', '🥉']
    classes = ['first', 'second', 'third']
    spots = []
    for i, p in enumerate(top):
        head, detail = praise[i]
        spots.append(f'''
      <div class="spot {classes[i]}">
        <div class="medal">{medals[i]}</div>
        <div class="name">{escape(p['name'])}</div>
        <div class="praise">{escape(head)}<br>{escape(detail)}</div>
        <div class="block"><div class="n">{p['games']}</div><div class="l">{t['rounds_unit']}</div><div class="pos">{i + 1}</div></div>
      </div>''')
    # podium order: 2nd, 1st, 3rd
    order = [1, 0, 2][:len(spots)] if len(spots) == 3 else ([1, 0] if len(spots) == 2 else [0])
    template = (HERE / 'template.html').read_text()
    return (template
            .replace('{{PILL}}', escape(f'{event.upper()} · GRADIENT DESCENT GOLF'))
            .replace('{{TITLE}}', t['title'])
            .replace('{{SUB}}', escape(t['sub'].format(event=event.upper())))
            .replace('{{PODIUM}}', ''.join(spots[i] for i in order))
            .replace('{{FOOT}}', t['foot'].format(rounds=ctx['rounds'], players=ctx['players']))
            .replace('{{THANKS}}', escape(t['thanks'])))


def render_png(html_path: Path, png_path: Path) -> None:
    env = dict(os.environ)
    try:  # playwright is used from the global npm install, not a project dependency
        root = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True, check=True).stdout.strip()
        env['NODE_PATH'] = os.pathsep.join(filter(None, [root, env.get('NODE_PATH')]))
    except (OSError, subprocess.CalledProcessError):
        pass
    subprocess.run(['node', str(HERE / 'render.cjs'), str(html_path), str(png_path)], check=True, env=env)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('event')
    ap.add_argument('--lang', choices=list(TEXT), default='en')
    ap.add_argument('--out', help='output folder (default: recaps/<event>)')
    ap.add_argument('--project', default=os.environ.get('VITE_FIREBASE_PROJECT_ID') or DEFAULT_PROJECT)
    args = ap.parse_args()

    rounds = fetch_rounds(args.project, args.event)
    if not rounds:
        sys.exit(f'No rounds found for event "{args.event}" in project "{args.project}".')
    players = summarize(rounds)
    top = players[:3]
    levels = sorted({r['difficulty'] for r in rounds}, key=lambda d: LEVEL_ORDER.index(d) if d in LEVEL_ORDER else 99)
    ctx = {
        't': TEXT[args.lang], 'rounds': len(rounds), 'players': len(players), 'levels': levels,
        'top_best': max(p['best'] for p in players),
        'podium_best_avg': max(p['avg'] for p in top if p['games'] >= 3) if any(p['games'] >= 3 for p in top) else float('inf'),
    }
    praise = pick_praise(top, ctx)

    out = Path(args.out or f'recaps/{args.event}')
    out.mkdir(parents=True, exist_ok=True)
    stamps = sorted(r['ts'] for r in rounds if r['ts'])
    summary = {
        'event': args.event, 'generated': datetime.now().isoformat(timespec='seconds'),
        'first_round': stamps[0] if stamps else None, 'last_round': stamps[-1] if stamps else None,
        'rounds': len(rounds), 'players': len(players),
        'podium': [{'name': p['name'], 'games': p['games'], 'praise': ' — '.join(praise[i])} for i, p in enumerate(top)],
        'table': [{'name': p['name'], 'games': p['games'], 'best': int(p['best']), 'avg': round(p['avg']),
                   'levels': {lv: p['levels'][lv] for lv in levels if p['levels'][lv]}} for p in players],
    }
    (out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    html_path = out / 'podium.html'
    html_path.write_text(render_html(args.event, top, praise, ctx))
    png_path = out / 'podium.png'
    render_png(html_path, png_path)

    print(f'{args.event}: {len(rounds)} rounds, {len(players)} players, {summary["first_round"]} → {summary["last_round"]}')
    print(f'{"#":>3}  {"player":<22}{"games":>6}{"best":>7}{"avg":>7}  levels')
    for i, row in enumerate(summary['table'], 1):
        lv = ' · '.join(f'{k} {v}' for k, v in sorted(row['levels'].items(), key=lambda kv: -kv[1]))
        print(f'{i:>3}  {row["name"]:<22}{row["games"]:>6}{row["best"]:>7}{row["avg"]:>7}  {lv}')
    print('\nPodium captions:')
    for p in summary['podium']:
        print(f'  {p["name"]}: {p["praise"]}')
    print(f'\nWrote {png_path}, {html_path}, {out / "summary.json"}')


if __name__ == '__main__':
    main()
