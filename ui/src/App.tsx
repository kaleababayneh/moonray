import { useEffect, useState } from 'react';
import { GameProvider, useGame } from './midnight/GameContext';
import { Play } from './screens/Play';
import { Leaderboard } from './screens/Leaderboard';
import { Badges } from './screens/Badges';
import { HowItWorks } from './screens/HowItWorks';
import { LS_THEME } from './config';

type Screen = 'play' | 'leaderboard' | 'badges' | 'how';

const SCREENS: { key: Screen; label: string }[] = [
  { key: 'play', label: 'Play' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'badges', label: 'Badges' },
  { key: 'how', label: 'How it works' },
];

const Shell = () => {
  const g = useGame();
  const [screen, setScreen] = useState<Screen>('play');
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem(LS_THEME) as 'dark' | 'light') ?? 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>MOONRAY</h1>
          <span className="sub">slicer · sealed scores on midnight</span>
        </div>
        <nav className="nav" aria-label="Screens">
          {SCREENS.map((s) => (
            <button
              key={s.key}
              className={screen === s.key ? 'active' : ''}
              onClick={() => setScreen(s.key)}
              aria-current={screen === s.key ? 'page' : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="row">
          <button
            className="btn small ghost"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Toggle theme"
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          {g.connected ? (
            <button className="btn small" onClick={g.disconnect} title="Disconnect wallet">
              ● {g.walletName}
            </button>
          ) : (
            <button
              className="btn small primary"
              onClick={() => void g.connect().catch(() => undefined)}
              disabled={g.connecting || !g.contractAddress}
              title={g.contractAddress ? undefined : 'No deployment found'}
            >
              {g.connecting ? 'connecting…' : 'connect wallet'}
            </button>
          )}
        </div>
      </header>

      {screen === 'play' && <Play theme={theme} />}
      {screen === 'leaderboard' && <Leaderboard />}
      {screen === 'badges' && <Badges />}
      {screen === 'how' && <HowItWorks />}
    </div>
  );
};

export const App = () => (
  <GameProvider>
    <Shell />
  </GameProvider>
);
