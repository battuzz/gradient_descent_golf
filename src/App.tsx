import { Leaderboard } from './components/Leaderboard';
import { Game } from './components/Game';
import { useRoute } from './lib/route';
import { LangProvider, LANGS, useLang } from './lib/i18n';

function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const other = LANGS.find((l) => l.id !== lang) ?? LANGS[0];
  return (
    <button
      className="lang-switch"
      onClick={() => setLang(other.id)}
      aria-label={`Switch language to ${other.code}`}
      title={`${other.flag} ${other.code}`}
    >
      {other.flag} {other.code}
    </button>
  );
}

function Routed() {
  const route = useRoute();
  return route.path === '/play' ? <Game event={route.event} /> : <Leaderboard event={route.event} />;
}

export default function App() {
  return (
    <LangProvider>
      <Routed />
      <LanguageSwitcher />
    </LangProvider>
  );
}
