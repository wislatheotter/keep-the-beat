import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type Route = 'home' | 'about' | 'privacy' | 'licenses';

export const PATHS: Record<Route, string> = { home: '/', about: '/about', privacy: '/privacy', licenses: '/licenses' };

export function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '');
  if (path === PATHS.about) return 'about';
  if (path === PATHS.privacy) return 'privacy';
  if (path === PATHS.licenses) return 'licenses';
  return 'home';
}

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };
const doc: TransitionDocument = document;
export const HAS_VIEW_TRANSITIONS = typeof doc.startViewTransition === 'function';

type Navigate = (to: string) => void;

const NavigateContext = createContext<Navigate>(() => {});

export function useRouter() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback<Navigate>(
    (to) => {
      const [path, hash = ''] = to.split('#');
      const target = () => (hash ? document.getElementById(hash) : null);
      if (path === window.location.pathname) {
        target()?.scrollIntoView({ block: 'start' });
        return;
      }
      history.pushState({}, '', `${path}${window.location.search}${hash ? `#${hash}` : ''}`);
      const commit = () => {
        flushSync(() => setPath(path));
        window.scrollTo({ top: 0 });
        document.querySelector('.site')?.scrollTo({ top: 0 });
        target()?.scrollIntoView({ block: 'start' });
      };
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (doc.startViewTransition && !still) doc.startViewTransition(commit);
      else commit();
    },
    [],
  );

  return { route: routeOf(path), navigate };
}

export function RouterProvider({ navigate, children }: { navigate: Navigate; children: ReactNode }) {
  return <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>;
}

type LinkProps = { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export function Link({ to, children, ...rest }: LinkProps) {
  const navigate = useContext(NavigateContext);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
