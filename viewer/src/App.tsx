import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beatToSeconds, parseBms, parseReplay, secondsToBeat } from "./bms";
import ChartCanvas from "./ChartCanvas";
import Timeline from "./Timeline";
import IidxSearch from "./IidxSearch";
import { fetchCatalog, fetchChart, matchReplay, difficultyOf } from "./textage";
import { chartEvents } from "./chart-events";
import { ChartAudio } from "./chart-audio";
import { SOUND_OPTIONS } from "./sound-events";
import type { SoundType } from "./sound-events";
import { bpmAt, greenFor, hiSpeedFor, DEFAULT_GREEN } from "./viewer-model";
import type { PlaySide } from "./viewer-model";
import type { CatalogSong, Chart, Difficulty, Replay } from "./types";
import "./styles.css";

type Entry = { id: number; chart: Chart };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function App() {
  const [playlist, setPlaylist] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingReplay, setPendingReplay] = useState<{data: Replay; name: string} | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayName, setReplayName] = useState("");
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [hiSpeed, setHiSpeed] = useState(() => hiSpeedFor(150, DEFAULT_GREEN));
  const [playbackRate, setPlaybackRate] = useState(1);
  const [offsetMs, setOffsetMs] = useState(0);
  const [side, setSide] = useState<PlaySide>("1P");
  const [sourceSide, setSourceSide] = useState<PlaySide>("1P");
  const [showInputs, setShowInputs] = useState(true);
  const [hidePassed, setHidePassed] = useState(true);
  const [explosions, setExplosions] = useState(true);
  const [soundLanes, setSoundLanes] = useState<boolean[]>(() => Array(8).fill(true));
  const [keyVolume, setKeyVolume] = useState(1);
  const [scratchVolume, setScratchVolume] = useState(1);
  const [keySound, setKeySound] = useState<SoundType>('beep');
  const [scratchSound, setScratchSound] = useState<SoundType>('clap');
  const [audio] = useState(() => new ChartAudio());
  const [seekRevision, setSeekRevision] = useState(0);
  const [startMeasure, setStartMeasure] = useState(1);
  const [endMeasure, setEndMeasure] = useState(1);
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"playlist" | "options" | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const chartInput = useRef<HTMLInputElement>(null);
  const replayInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const playhead = useRef(0);
  const requestId = useRef(0);
  const chart = playlist.find(entry => entry.id === activeId)?.chart ?? null;
  const duration = chart ? beatToSeconds(chart, chart.durationBeat) : 0;
  const maxMeasure = Math.max(1, (chart?.measureStarts.length ?? 2) - 1);
  const currentBeat = chart ? secondsToBeat(chart, time) : 0;
  const bpm = chart ? bpmAt(chart.bpmPoints, chart.initialBpm, currentBeat) : 150;
  const green = greenFor(bpm, hiSpeed);
  const startTime = chart ? beatToSeconds(chart, chart.measureStarts[startMeasure - 1]) : 0;
  const endTime = chart ? beatToSeconds(chart, chart.measureStarts[endMeasure] ?? chart.durationBeat) : 0;
  const pressedCount = useMemo(() => replay?.events.filter(event => event.pressed).length ?? 0, [replay]);
  const hits = useMemo(() => chart ? chartEvents(chart) : [], [chart]);
  const loadCatalog = useCallback(async () => {
    try { setCatalog(await fetchCatalog()); setStatus(''); }
    catch (error) { setStatus(error instanceof Error ? error.message : '曲一覧を取得できませんでした'); }
  }, []);
  useEffect(() => { void loadCatalog(); return () => { requestId.current++; }; }, [loadCatalog]);
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => { audio.configure({ lanes:soundLanes, keyVolume, scratchVolume, keySound, scratchSound }); }, [audio,soundLanes,keyVolume,scratchVolume,keySound,scratchSound]);

  const seek = useCallback((seconds: number) => {
    const next = clamp(seconds, 0, duration);
    playhead.current = next; setTime(next); setSeekRevision(value => value + 1);
  }, [duration]);

  useEffect(() => {
    if (!isPlaying || !chart) return;
    let frame = 0;
    audio.start(hits, playhead.current, endTime, playbackRate);
    const tick = () => {
      playhead.current = audio.position;
      setTime(playhead.current);
      if (playhead.current >= endTime) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); audio.stop(); };
  }, [isPlaying, chart, endTime, playbackRate, seekRevision, hits, audio]);

  const selectChart = (entry: Entry) => {
    setHiSpeed(hiSpeedFor(bpmAt(entry.chart.bpmPoints, entry.chart.initialBpm, 0), DEFAULT_GREEN));
    setActiveId(entry.id); setPlaying(false); setTime(0); playhead.current = 0;
    setStartMeasure(1); setEndMeasure(Math.max(1, entry.chart.measureStarts.length - 1));
    setReplay(null); setReplayName(""); setOffsetMs(0); setError(""); setMobilePanel(null);
    setPendingReplay(null);
  };
  const addChart = (loaded: Chart) => {
    const entry = { id: nextId.current++, chart: loaded };
    setPlaylist(old => [...old, entry]); selectChart(entry);
  };
  const onChartFile = async (file: File | undefined) => {
    if (!file) return;
    const token = ++requestId.current;
    setLoading(false); setStatus('');
    try { const loaded = parseBms(await file.arrayBuffer()); if (token === requestId.current) addChart(loaded); }
    catch { setError("譜面を読み込めませんでした。BMS / BMEファイルを確認してください。"); }
  };
  const attachReplay = (data: Replay, name: string) => {
    setReplay(data); setReplayName(name); setShowInputs(true);
    setSourceSide(data.events.some(event => event.lane <= 8) ? '1P' : '2P');
  };
  const loadIidx = async (id: string, difficulty: Difficulty, log = pendingReplay) => {
    const token = ++requestId.current;
    setLoading(true); setError(''); setStatus('IIDX譜面を読み込み中…'); setPlaying(false);
    try {
      const loaded = await fetchChart(id,difficulty);
      if (token !== requestId.current) return;
      addChart(loaded);
      if (log) attachReplay(log.data,log.name);
      setQuery(''); setStatus(`${loaded.title} [${difficulty}]${log ? ' と入力ログを読み込みました。入力補正で開始位置を合わせられます。' : ' を読み込みました。'}`);
    } catch (error) { if (token === requestId.current) { setError(error instanceof Error ? error.message : '譜面を取得できませんでした'); setStatus('読み込みに失敗しました。検索結果から再試行できます。'); } }
    finally { if (token === requestId.current) setLoading(false); }
  };
  const onReplayFile = async (file: File | undefined) => {
    if (!file) return;
    const token = ++requestId.current;
    setPlaying(false); setLoading(false); setError(''); setPendingReplay(null);
    let loaded: Replay;
    try {
      loaded = parseReplay(JSON.parse(await file.text()));
      if (!loaded.events.length) throw new Error("Empty input log");
    } catch { if (token === requestId.current) setError("入力ログを読み込めませんでした。BMKeyLoggerのJSONを選択してください。"); return; }
    if (token !== requestId.current) return;
    if (loaded.game?.toLowerCase() !== 'iidx' && !loaded.chartSource && (loaded.game || !difficultyOf(loaded.chart))) { attachReplay(loaded,file.name); setStatus('入力ログを読み込みました。'); return; }
    const log = { data:loaded, name:file.name };
    setPendingReplay(log); setReplay(null); setReplayName(''); setQuery(loaded.title); setStatus('ログの曲名・難易度を照合中…'); setLoading(true);
    try {
      const songs = await fetchCatalog();
      if (token !== requestId.current) return;
      setCatalog(songs);
      const match = matchReplay(songs,loaded);
      if (match.automatic) { await loadIidx(match.matches[0].id,match.difficulty!,log); return; }
      setLoading(false); setStatus(match.matches.length ? '候補の曲・難易度を選択してください。' : '曲名を照合できませんでした。検索して対応する譜面を選択してください。');
    } catch (error) { if (token === requestId.current) { setLoading(false); setStatus(error instanceof Error ? error.message : '曲一覧を取得できませんでした'); } }
  };
  const loadDemo = async () => {
    const token = ++requestId.current;
    setLoading(false); setStatus('');
    try {
      const response = await fetch("demo.bms");
      if (!response.ok) throw new Error("Demo unavailable");
      const loaded = parseBms(await response.arrayBuffer());
      if (token === requestId.current) addChart(loaded);
    } catch { setError("デモ譜面を読み込めませんでした。"); }
  };
  const togglePlay = useCallback(async () => {
    if (!chart) return;
    if (isPlaying) { playhead.current = audio.position; setTime(playhead.current); setPlaying(false); return; }
    const token = requestId.current;
    try { await audio.unlock(); } catch { setError('音声を開始できませんでした。ブラウザの音声設定を確認して再生し直してください。'); return; }
    if (token !== requestId.current) return;
    if (!isPlaying && (playhead.current >= endTime || playhead.current < startTime)) seek(startTime);
    setPlaying(true);
  }, [chart, isPlaying, startTime, endTime, seek, audio]);
  const moveMeasure = (direction: number) => {
    if (!chart) return;
    let index = 0;
    chart.measureStarts.forEach((beat, position) => { if (beat <= currentBeat + 1e-6) index = position; });
    seek(beatToSeconds(chart, chart.measureStarts[clamp(index + direction, 0, maxMeasure - 1)]));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|BUTTON|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); togglePlay(); }
      if (event.code === "Escape") { setMobilePanel(null); setShowHelp(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  return <main className="app">
    <header className="site-header"><h1>BM Chart Viewer</h1><button className="help-button" aria-label="ヘルプを表示" aria-expanded={showHelp} onClick={() => setShowHelp(value => !value)}>?</button></header>
    {showHelp && <div className="help-panel panel"><p>曲名またはTexTageのURLでIIDX譜面を検索し、N / H / A / Lを選択します。「ログからIIDX譜面を開く」では入力ログJSONの曲名・難易度から譜面を取得します。BMS / BMEのローカル読み込みにも対応しています。</p><p>Spaceで再生・一時停止。Handclapはノーツの開始・終端が判定ラインに到達すると鳴ります。楽曲の音源ではありません。CN / HCNは長い帯、BSS / HBSSは皿レーンの帯と返しの矢印で表示します。</p><p>Hi-Speedはノーツのスクロール倍率です。緑数字はIIDX基準で、300なら約500 msの表示時間です。Orajaの表示時間500 msに相当します。</p><p>Playsideは皿の左右を切り替えます。入力ログの1P / 2Pは「入力ログ」内で選択できます。ログとの開始位置は入力補正で調整してください。</p></div>}
    <IidxSearch catalog={catalog} query={query} onQuery={setQuery} onLoad={(id,difficulty) => { void loadIidx(id,difficulty); }} loading={loading} status={status} onRetry={() => { void loadCatalog(); }} pendingReplay={!!pendingReplay} onCancelReplay={() => { requestId.current++; setPendingReplay(null); setLoading(false); setStatus(''); }} />
    <input className="visually-hidden" ref={chartInput} type="file" aria-label="BMS / BMEファイル" accept=".bms,.bme,.bml,text/plain" onChange={event => { void onChartFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input className="visually-hidden" ref={replayInput} type="file" aria-label="入力ログJSONファイル" accept="application/json,.json" onChange={event => { void onReplayFile(event.target.files?.[0]); event.target.value = ""; }} />
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="viewer-layout">
      <aside className={"panel playlist-panel " + (mobilePanel === "playlist" ? "mobile-open" : "")} aria-label="Playlist">
        <div className="panel-heading"><h2>Playlist</h2><button className="mobile-only" onClick={() => setMobilePanel(null)}>閉じる</button></div>
        <div className="playlist-caption">History（読込順）</div>
        <div className="playlist-items">{playlist.map((entry, index) => <button className={"playlist-entry " + (entry.id === activeId ? "current" : "")} key={entry.id} onClick={() => { requestId.current++; setLoading(false); setStatus(''); selectChart(entry); }}><span>{index + 1}.</span><strong>★{entry.chart.level || "?"} {entry.chart.title} {entry.chart.source ? `[${entry.chart.source.difficulty}]` : ''}</strong></button>)}{!playlist.length && <p className="muted playlist-empty">譜面が読み込まれていません</p>}</div>
        <button className="quiet clear-button" disabled={!playlist.length} onClick={() => { requestId.current++; setLoading(false); setPendingReplay(null); setStatus(''); setPlaylist([]); setActiveId(null); setReplay(null); setReplayName(""); setPlaying(false); seek(0); }}>クリア</button>
        <div className="file-actions"><button onClick={() => replayInput.current?.click()}>ログからIIDX譜面を開く</button><button onClick={() => chartInput.current?.click()}>BMS / BMEを開く</button><button className="quiet" onClick={loadDemo}>デモ譜面を表示</button></div>
        <details className="log-details"><summary>打鍵ログ{replay ? " · " + pressedCount + " presses" : ""}</summary><button onClick={() => replayInput.current?.click()}>打鍵JSONを開く</button><p className="muted">{replayName || "未読込"}</p><label>記録元 <select aria-label="ログの入力サイド" value={sourceSide} onChange={event => setSourceSide(event.target.value as PlaySide)}><option>1P</option><option>2P</option></select></label><p className="muted">黄色の枠は押下、細線は離した時刻です。</p></details>
      </aside>
      <section className="center-column" aria-label="譜面ビューアー">
        <div className="panel song-info">
          <h2>{chart ? "★" + (chart.level || "?") + " " + chart.title : "譜面を選択してください"}</h2>
          <p className="artist">{chart?.artist || "IIDX / BMS"}</p>
          <p className="subtitle">{chart?.source ? `${chart.genre} · ${chart.source.difficulty}` : chart?.subtitle || (chart ? "7KEYS" : "上の検索欄からIIDX譜面を選択")}</p>
          <div className="song-stats"><span>SP</span><span>BPM: {chart ? Math.round(bpm) : "—"}</span><span>Notes: {chart?.noteCount ?? chart?.notes.length ?? "—"}</span>{chart?.source && <a href={chart.source.url} target="_blank" rel="noreferrer">TexTage</a>}</div>
          <div className="song-actions"><button className="mobile-only" onClick={() => setMobilePanel("playlist")}>Playlist</button><button onClick={() => chartInput.current?.click()}>譜面を開く</button><button onClick={() => replayInput.current?.click()}>入力ログ</button><button className="mobile-only" onClick={() => setMobilePanel("options")}>Options</button></div>
        </div>
        <div className="canvas-frame"><ChartCanvas chart={chart} replay={replay} time={time} hiSpeed={hiSpeed} offsetMs={offsetMs} side={side} sourceSide={sourceSide} showInputs={showInputs} hidePassed={hidePassed} explosions={explosions} isPlaying={isPlaying} playbackRate={playbackRate} hits={hits} />{!chart && <div className="canvas-empty"><p>曲名・TexTage URLで検索</p><button onClick={() => replayInput.current?.click()}>ログからIIDX譜面を開く</button><button className="quiet" onClick={() => chartInput.current?.click()}>BMS / BMEを開く</button></div>}</div>
        <div className="panel transport">
          <div className="transport-buttons"><button aria-label="前の小節" disabled={!chart} onClick={() => moveMeasure(-1)}>-1小節</button><button className="play-button" aria-label={isPlaying ? "一時停止" : "再生"} disabled={!chart} onClick={togglePlay}>{isPlaying ? "一時停止" : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></svg>}</button><button aria-label="次の小節" disabled={!chart} onClick={() => moveMeasure(1)}>+1小節</button></div>
          <Timeline chart={chart} time={time} duration={duration} onSeek={seek} />
          <div className="transport-footer"><button className="quiet" disabled={!chart} onClick={() => { seek(0); setPlaying(false); }}>先頭へ</button><label>時間倍率 <select aria-label="時間倍率" value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}>{[.1, .25, .5, .75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate.toFixed(2)}×</option>)}</select></label></div>
        </div>
      </section>
      <aside className={"panel options-panel " + (mobilePanel === "options" ? "mobile-open" : "")} aria-label="Options">
        <div className="panel-heading"><h2>Options</h2><button className="mobile-only" onClick={() => setMobilePanel(null)}>閉じる</button></div>
        <section className="option-group"><h3>Measure</h3><div className="measure-inputs"><input aria-label="開始小節" type="number" min={1} max={endMeasure} step={1} value={startMeasure} disabled={!chart} onChange={event => { const value = clamp(Math.round(Number(event.target.value)), 1, endMeasure); setStartMeasure(value); if (chart) seek(beatToSeconds(chart, chart.measureStarts[value - 1])); }} /><span>-</span><input aria-label="終了小節" type="number" min={startMeasure} max={maxMeasure} step={1} value={endMeasure} disabled={!chart} onChange={event => setEndMeasure(clamp(Math.round(Number(event.target.value)), startMeasure, maxMeasure))} /><small>(MAX: {maxMeasure})</small></div></section>
        <section className="option-group"><div className="option-heading"><h3>Hi-Speed</h3><button className="reset" onClick={() => setHiSpeed(1)}>Reset</button><output>{hiSpeed.toFixed(2)}x</output></div><div className="slider-row"><input aria-label="Hi-Speed" type="range" min={.1} max={20} step={.01} value={hiSpeed} onChange={event => setHiSpeed(Number(event.target.value))} /><input aria-label="Hi-Speed 数値" type="number" min={.1} max={20} step={.01} value={Number(hiSpeed.toFixed(2))} onChange={event => { if (Number(event.target.value) > 0) setHiSpeed(clamp(Number(event.target.value), .1, 20)); }} /></div></section>
        <section className="option-group green-option"><div className="option-heading"><h3>緑数字</h3><button className="reset" onClick={() => setHiSpeed(hiSpeedFor(bpm, DEFAULT_GREEN))}>Reset</button><output>HS: {hiSpeed.toFixed(2)}</output></div><div className="slider-row"><input aria-label="緑数字" type="range" min={100} max={1500} step={1} value={clamp(Math.round(green), 100, 1500)} onChange={event => setHiSpeed(hiSpeedFor(bpm, Number(event.target.value)))} /><input aria-label="緑数字 数値" type="number" min={100} max={9999} value={Math.round(green)} onChange={event => { const value = Number(event.target.value); if (value >= 100 && value <= 9999) setHiSpeed(hiSpeedFor(bpm, value)); }} /></div><p className="green-description">表示時間 {Math.round(green / .6)} ms · IIDX基準</p></section>
        <hr />
        <section className="option-group"><h3>Playside</h3><div className="segmented" role="group" aria-label="プレイサイド">{(["1P", "2P"] as const).map(value => <button key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value}</button>)}</div></section>
        <section className="option-group">
          <div className="option-heading"><h3>Handclap</h3><button className="reset" onClick={() => setSoundLanes(Array(8).fill(true))}>All</button><button className="reset" onClick={() => setSoundLanes(Array(8).fill(false))}>None</button></div>
          <div className="clap-lanes" role="group" aria-label="打鍵音レーン">{['SC','1','2','3','4','5','6','7'].map((name,lane) => <button key={name} aria-pressed={soundLanes[lane]} onClick={() => setSoundLanes(old => old.map((enabled,index) => index === lane ? !enabled : enabled))}>{name}</button>)}</div>
          <div className="sound-controls">
            <div className="sound-heading"><label htmlFor="scratch-sound">Scratch音</label><output>{Math.round(scratchVolume * 100)}%</output></div>
            <div className="sound-row">
              <select id="scratch-sound" aria-label="Scratchの音色" value={scratchSound} onChange={event => setScratchSound(event.target.value as SoundType)}>{SOUND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <input aria-label="Scratchの音量" type="range" min={0} max={2.5} step={.05} value={scratchVolume} onChange={event => setScratchVolume(Number(event.target.value))} />
            </div>
            <div className="sound-heading"><label htmlFor="key-sound">鍵盤音</label><output>{Math.round(keyVolume * 100)}%</output></div>
            <div className="sound-row">
              <select id="key-sound" aria-label="鍵盤の音色" value={keySound} onChange={event => setKeySound(event.target.value as SoundType)}>{SOUND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <input aria-label="鍵盤の音量" type="range" min={0} max={2.5} step={.05} value={keyVolume} onChange={event => setKeyVolume(Number(event.target.value))} />
            </div>
          </div>
        </section>
        <section className="option-group"><h3>Visual</h3><label className="check-row"><input type="checkbox" checked={hidePassed} onChange={event => setHidePassed(event.target.checked)} />判定ラインでオブジェクトを消す</label><label className="check-row"><input type="checkbox" checked={explosions} onChange={event => setExplosions(event.target.checked)} />爆発エフェクトを入れる</label><label className="check-row"><input type="checkbox" checked={showInputs} onChange={event => setShowInputs(event.target.checked)} />打鍵ログを重ねて表示</label></section>
        <section className="option-group"><div className="option-heading"><h3>入力補正</h3><button className="reset" onClick={() => setOffsetMs(0)}>Reset</button><output>ms</output></div><div className="slider-row"><input aria-label="入力補正" type="range" min={-500} max={500} step={1} value={clamp(offsetMs, -500, 500)} onChange={event => setOffsetMs(Number(event.target.value))} /><input aria-label="入力補正 数値" type="number" min={-60000} max={60000} step={1} value={offsetMs} onChange={event => setOffsetMs(clamp(Number(event.target.value), -60000, 60000))} /></div></section>
      </aside>
    </div>
    <footer>BMKeyLogger · <a href="https://textage-chart-viewer.vercel.app/chart/12/_mei/a/sp" target="_blank" rel="noreferrer">TexTage Chart Viewer</a> を参考にした譜面・打鍵ビューアー</footer>
  </main>;
}

export default App;
