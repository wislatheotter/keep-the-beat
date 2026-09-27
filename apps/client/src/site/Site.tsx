import { useEffect } from 'react';
import { About } from './About';
import { Home, type HomeProps } from './Home';
import { Licenses } from './Licenses';
import { Privacy } from './Privacy';
import { GITHUB_URL } from './links';
import { HAS_VIEW_TRANSITIONS, Link, PATHS, RouterProvider, useRouter } from './router';
import { useParallax } from './useParallax';
import './site.css';

const TITLES: Record<string, string> = {
  home: 'Keep the Beat: a co-op music game',
  about: 'About · Keep the Beat',
  privacy: 'Privacy · Keep the Beat',
  licenses: 'Licenses · Keep the Beat',
};

export function Site(props: HomeProps) {
  const { route, navigate } = useRouter();
  const ref = useParallax<HTMLDivElement>();

  useEffect(() => {
    document.title = TITLES[route] ?? 'Keep the Beat';
    return () => {
      document.title = 'Keep the Beat';
    };
  }, [route]);

  return (
    <RouterProvider navigate={navigate}>
      <div className="site" ref={ref} data-viewtransitions={HAS_VIEW_TRANSITIONS ? 'on' : 'off'}>
        <div className="site-backdrop" aria-hidden="true">
          <i />
          <b />
          <b />
          <b />
        </div>

        <header className="site-head">
          <Link to={PATHS.home} className="wordmark" aria-label="Keep the Beat, home">
            <img className="wordmark-mark" src="/logo/mark.svg" alt="" width={38} height={38} />
            <span className="wordmark-name">Keep the Beat</span>
          </Link>
          <nav className="site-nav">
            <Link to={PATHS.about} aria-current={route === 'about' ? 'page' : undefined}>
              About
            </Link>
            <Link to={PATHS.privacy} aria-current={route === 'privacy' ? 'page' : undefined}>
              Privacy
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </nav>
        </header>

        <main className="route" key={route}>
          {route === 'about' ? <About />
            : route === 'privacy' ? <Privacy />
              : route === 'licenses' ? <Licenses />
                : <Home {...props} />}
        </main>

        <footer className="site-foot">
          <span>© 2026 Wisla the Otter</span>
        </footer>
      </div>
    </RouterProvider>
  );
}
