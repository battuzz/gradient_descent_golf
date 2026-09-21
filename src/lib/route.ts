import { useEffect, useState } from 'react';

export interface Route {
  path: '/' | '/play';
  event: string;
}

export const DEFAULT_EVENT = 'demo';
const EVENT_KEY = 'gdg.event';

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [p, qs = ''] = raw.split('?');
  const params = new URLSearchParams(qs);
  const stored = localStorage.getItem(EVENT_KEY);
  return {
    path: p === '/play' ? '/play' : '/',
    event: (params.get('e') || stored || DEFAULT_EVENT).slice(0, 40),
  };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

export function navigate(path: '/' | '/play', event: string) {
  window.location.hash = `${path}?e=${encodeURIComponent(event)}`;
}

export function setStoredEvent(e: string) {
  localStorage.setItem(EVENT_KEY, e);
  window.location.hash = `/?e=${encodeURIComponent(e)}`;
}

/** Absolute URL a phone should open to start playing this event. */
export function playUrl(event: string, base?: string): string {
  const root = (base || window.location.href.split('#')[0]).replace(/\/?$/, '/');
  return `${root}#/play?e=${encodeURIComponent(event)}`;
}
