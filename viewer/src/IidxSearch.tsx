import { useMemo, useState } from 'react';
import { chartUrlQuery, searchSongs } from './textage';
import type { CatalogSong, Difficulty } from './types';

type Props = { catalog: CatalogSong[]; query: string; onQuery: (query: string) => void; onLoad: (id: string, difficulty: Difficulty) => void; loading: boolean; status: string; onRetry: () => void; pendingReplay: boolean; onCancelReplay: () => void };
export default function IidxSearch({catalog, query, onQuery, onLoad, loading, status, onRetry, pendingReplay, onCancelReplay}: Props) {
  const [open, setOpen] = useState(false);
  const [infinitasOnly, setInfinitasOnly] = useState(true);
  // Replay recovery searches all published versions, including HCN variants.
  const results = useMemo(() => searchSongs(catalog, query, pendingReplay ? false : infinitasOnly), [catalog,query,infinitasOnly,pendingReplay]);
  const url = chartUrlQuery(query);
  return <div className="search-row iidx-search">
    <form onSubmit={event => { event.preventDefault(); setOpen(true); if (url?.difficulty && results.length === 1) { onLoad(results[0].id,url.difficulty); setOpen(false); } }}>
      <input aria-label="TexTageの曲名・URLを検索" placeholder="曲名で検索 / TexTageの譜面URLを入力" value={query} onFocus={() => setOpen(true)} onChange={event => { onQuery(event.target.value); setOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} />
      <button type="submit" disabled={loading}>検索</button>
    </form>
    {status && <p className="search-status" role="status">{status}{!catalog.length && !loading && <button className="quiet" onClick={onRetry}>再試行</button>}</p>}
    {(open && query.trim() || pendingReplay) && <section className="search-results panel" aria-label="IIDX検索結果">
      <div className="search-tools"><label className="check-row"><input type="checkbox" checked={infinitasOnly} disabled={pendingReplay} onChange={event => setInfinitasOnly(event.target.checked)} />INFINITASのみ</label><button className="quiet" onClick={() => { setOpen(false); if (pendingReplay) onCancelReplay(); }}>{pendingReplay ? '照合をキャンセル' : '閉じる'}</button></div>
      {pendingReplay && <p className="muted">ログの曲名・難易度を確認して選択してください。検索語は修正できます。</p>}
      <div className="search-list">{results.slice(0,40).map(song => <article className="search-song" key={song.id}><div><strong>{song.title}</strong><small>{song.artist}</small></div><div className="difficulty-buttons">{song.difficulties.filter(d => url || pendingReplay || !infinitasOnly || d.infinitas).map(d => <button key={d.difficulty} className={'difficulty-' + d.difficulty} aria-label={`${song.title} ${d.difficulty} ☆${d.level}`} disabled={loading} onClick={() => { onLoad(song.id,d.difficulty); setOpen(false); }}>{d.difficulty} {d.level}</button>)}</div></article>)}</div>
      {!results.length && <p className="muted">{loading ? '読み込み中…' : '候補がありません。曲名を短くするか、INFINITASの絞り込みを外してください。'}</p>}
      {results.length > 40 && <p className="muted">{results.length}件中40件を表示。曲名を絞り込んでください。</p>}
      <a className="source-link" href="https://textage.cc/score/" target="_blank" rel="noreferrer">譜面データ：TexTage</a>
    </section>}
  </div>;
}
