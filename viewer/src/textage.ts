import type { CatalogSong, Chart, Difficulty, Replay } from './types';

export const normalizeTitle = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export function difficultyOf(text: string): Difficulty | null {
  const match = text.trim().toUpperCase().match(/^(?:SP\s*)?(N|H|A|L|NORMAL|HYPER|ANOTHER|LEGGENDARIA)$/);
  return match ? match[1][0] as Difficulty : null;
}
export function chartUrlQuery(text: string): { id: string; difficulty: Difficulty | null } | null {
  try {
    const url = new URL(text);
    if (url.hostname === 'textage-chart-viewer.vercel.app') {
      const match = url.pathname.match(/^\/chart\/(?:\d+|s)\/([\w-]+)\/([nhalx])\/sp\/?$/i);
      return match ? { id:match[1], difficulty:match[2].toUpperCase() === 'X' ? 'L' : match[2].toUpperCase() as Difficulty } : null;
    }
    if (url.hostname === 'textage.cc' || url.hostname === 'www.textage.cc') {
      const match = url.pathname.match(/^\/score\/(?:\d+|s)\/([\w-]+)\.html$/);
      const code = url.search[2]?.toUpperCase();
      if (url.search && !['1','2'].includes(url.search[1])) return null;
      return match ? { id:match[1], difficulty:code === 'X' ? 'L' : code === 'L' ? 'N' : difficultyOf(code ?? '') } : null;
    }
  } catch { /* A song title, not a URL. */ }
  return null;
}
export function searchSongs(catalog: CatalogSong[], query: string, infinitasOnly: boolean) {
  const url = chartUrlQuery(query), terms = query.trim().split(/\s+/).map(normalizeTitle).filter(Boolean);
  if (!url && !terms.length) return [];
  return catalog.filter(song => (url || !infinitasOnly || song.difficulties.some(d => d.infinitas)) && (url ? song.id === url.id : terms.every(term => normalizeTitle(song.title + ' ' + song.artist).includes(term))))
    .sort((a,b) => Number(normalizeTitle(b.title) === normalizeTitle(query)) - Number(normalizeTitle(a.title) === normalizeTitle(query)) || a.title.localeCompare(b.title, 'ja'));
}
export function matchReplay(catalog: CatalogSong[], replay: Replay) {
  const difficulty = replay.chartSource?.difficulty ?? difficultyOf(replay.chart);
  const title = normalizeTitle(replay.title);
  const candidates = catalog.filter(song => replay.chartSource ? song.id === replay.chartSource.id : !!title && normalizeTitle(song.title) === title);
  const matches = difficulty ? candidates.filter(song => song.difficulties.some(d => d.difficulty === difficulty)) : candidates;
  return { difficulty, matches, automatic:matches.length === 1 && difficulty !== null };
}
async function jsonResponse<T>(path: string): Promise<T> {
  const response = await fetch(path, { signal:AbortSignal.timeout(25000) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('IIDX読込には npm run dev または npm run preview でローカルAPIを起動してください。');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'TexTageから取得できませんでした。再試行してください。');
  return data;
}
let catalogPromise: Promise<CatalogSong[]> | null = null;
export function fetchCatalog() {
  return catalogPromise ??= jsonResponse<CatalogSong[]>('/api/textage/catalog').catch(error => { catalogPromise = null; throw error; });
}
export const fetchChart = (id: string, difficulty: Difficulty) => jsonResponse<Chart>(`/api/textage/chart?id=${encodeURIComponent(id)}&difficulty=${difficulty}`);
