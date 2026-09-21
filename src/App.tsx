import { Leaderboard } from './components/Leaderboard';
import { Game } from './components/Game';
import { useRoute } from './lib/route';

export default function App() {
  const route = useRoute();
  return route.path === '/play' ? <Game event={route.event} /> : <Leaderboard event={route.event} />;
}
