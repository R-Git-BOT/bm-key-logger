import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beatToSeconds, parseBms, parseReplay, secondsToBeat } from "./bms";
import ChartCanvas from "./ChartCanvas";
import Timeline from "./Timeline";
import { bpmAt, greenFor, hiSpeedFor } from "./viewer-model";
import type { PlaySide } from "./viewer-model";
import type { Chart, Replay } from "./types";
import "./styles.css";

type Entry = { id: number; chart: Chart };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function App() {
  const [playlist, setPlaylist] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayName, setReplayName] = useState("");
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [hiSpeed, setHiSpeed] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [offsetMs, setOffsetMs] = useState(0);
  const [side, setSide] = useState<PlaySide>("1P");
  const [sourceSide, setSourceSide] = useState<PlaySide>("1P");
  const [showInputs, setShowInputs] = useState(true);
  const [hidePassed, setHidePassed] = useState(true);
  const [startMeasure, setStartMeasure] = useState(1);
  const [endMeasure, setEndMeasure] = useState(1);
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"playlist" | "options" | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const chartInput = useRef<HTMLInputElement>(null);
  const replayInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const playhead = useRef(0);
  const chart = playlist.find(entry => entry.id === activeId)?.chart ?? null;
  const duration = chart ? beatToSeconds(chart, chart.durationBeat) : 0;
  const maxMeasure = Math.max(1, (chart?.measureStarts.length ?? 2) - 1);
  const currentBeat = chart ? secondsToBeat(chart, time) : 0;
  const bpm = chart ? bpmAt(chart.bpmPoints, chart.initialBpm, currentBeat) : 150;
  const green = greenFor(bpm, hiSpeed);
  const startTime = chart ? beatToSeconds(chart, chart.measureStarts[startMeasure - 1]) : 0;
  const endTime = chart ? beatToSeconds(chart, chart.measureStarts[endMeasure] ?? chart.durationBeat) : 0;
  const pressedCount = useMemo(() => replay?.events.filter(event => event.pressed).length ?? 0, [replay]);
  const filtered = playlist.filter(entry => (entry.chart.title + " " + entry.chart.subtitle).toLowerCase().includes(query.toLowerCase()));

  const seek = useCallback((seconds: number) => {
    const next = clamp(seconds, 0, duration);
    playhead.current = next; setTime(next);
  }, [duration]);

  useEffect(() => {
    if (!isPlaying || !chart) return;
    let frame = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      const elapsed = previous === null ? 0 : (now - previous) / 1000;
      previous = now;
      playhead.current = Math.min(endTime, playhead.current + elapsed * playbackRate);
      setTime(playhead.current);
      if (playhead.current >= endTime) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, chart, endTime, playbackRate]);

  const selectChart = (entry: Entry) => {
    setActiveId(entry.id); setPlaying(false); setTime(0); playhead.current = 0;
    setStartMeasure(1); setEndMeasure(Math.max(1, entry.chart.measureStarts.length - 1));
    setReplay(null); setReplayName(""); setOffsetMs(0); setError(""); setMobilePanel(null);
  };
  const addChart = (loaded: Chart) => {
    const entry = { id: nextId.current++, chart: loaded };
    setPlaylist(old => [...old, entry]); selectChart(entry);
  };
  const onChartFile = async (file: File | undefined) => {
    if (!file) return;
    try { addChart(parseBms(await file.arrayBuffer())); }
    catch { setError("譜面を読み込めませんでした。BMS / BMEファイルを確認してください。"); }
  };
  const onReplayFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const loaded = parseReplay(JSON.parse(await file.text()));
      if (!loaded.events.length) throw new Error("Empty input log");
      setReplay(loaded); setReplayName(file.name); setError(""); setShowInputs(true);
      setSourceSide(loaded.events.some(event => event.lane <= 8) ? "1P" : "2P");
    } catch { setError("入力ログを読み込めませんでした。BMKeyLoggerのJSONを選択してください。"); }
  };
  const loadDemo = async () => {
    try {
      const response = await fetch("demo.bms");
      if (!response.ok) throw new Error("Demo unavailable");
      addChart(parseBms(await response.arrayBuffer()));
    } catch { setError("デモ譜面を読み込めませんでした。"); }
  };
  const togglePlay = useCallback(() => {
    if (!chart) return;
    if (!isPlaying && (playhead.current >= endTime || playhead.current < startTime)) seek(startTime);
    setPlaying(value => !value);
  }, [chart, isPlaying, startTime, endTime, seek]);
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
    {showHelp && <div className="help-panel panel"><p>BMS / BMEを開き、入力ログJSONを重ねて確認できます。Spaceで再生・一時停止。</p><p>Hi-Speedはノーツのスクロール倍率です。緑数字はIIDX基準で、300なら約500 msの表示時間です。Orajaの表示時間500 msに相当します。</p><p>Playsideは皿の左右を切り替えます。入力ログの1P / 2Pは「入力ログ」内で選択できます。</p></div>}
    <div className="search-row"><input aria-label="譜面を検索" placeholder="読み込んだ譜面を曲名で検索" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <input className="visually-hidden" ref={chartInput} type="file" aria-label="BMS / BMEファイル" accept=".bms,.bme,.bml,text/plain" onChange={event => { void onChartFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input className="visually-hidden" ref={replayInput} type="file" aria-label="入力ログJSONファイル" accept="application/json,.json" onChange={event => { void onReplayFile(event.target.files?.[0]); event.target.value = ""; }} />
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="viewer-layout">
      <aside className={"panel playlist-panel " + (mobilePanel === "playlist" ? "mobile-open" : "")} aria-label="Playlist">
        <div className="panel-heading"><h2>Playlist</h2><button className="mobile-only" onClick={() => setMobilePanel(null)}>閉じる</button></div>
        <div className="playlist-caption">History（読込順）</div>
        <div className="playlist-items">{filtered.map((entry, index) => <button className={"playlist-entry " + (entry.id === activeId ? "current" : "")} key={entry.id} onClick={() => selectChart(entry)}><span>{index + 1}.</span><strong>★{entry.chart.level || "?"} {entry.chart.title}</strong></button>)}{!filtered.length && <p className="muted playlist-empty">{playlist.length ? "該当する譜面がありません" : "譜面が読み込まれていません"}</p>}</div>
        <button className="quiet clear-button" disabled={!playlist.length} onClick={() => { setPlaylist([]); setActiveId(null); setReplay(null); setReplayName(""); setPlaying(false); seek(0); }}>クリア</button>
        <div className="file-actions"><button onClick={() => chartInput.current?.click()}>BMS / BMEを開く</button><button className="quiet" onClick={loadDemo}>デモ譜面を表示</button></div>
      </aside>
      <section className="center-column" aria-label="譜面ビューアー">
        <div className="panel song-info">
          <h2>{chart ? "★" + (chart.level || "?") + " " + chart.title : "譜面を選択してください"}</h2>
          <p className="artist">{chart?.artist || "BMS / BME"}</p>
          <p className="subtitle">{chart?.subtitle || (chart ? "7KEYS" : "ローカルファイルを読み込んで再生")}</p>
          <div className="song-stats"><span>SP</span><span>BPM: {chart ? Math.round(bpm) : "—"}</span><span>Notes: {chart?.notes.length ?? "—"}</span></div>
          <div className="song-actions"><button className="mobile-only" onClick={() => setMobilePanel("playlist")}>Playlist</button><button onClick={() => chartInput.current?.click()}>譜面を開く</button><button onClick={() => replayInput.current?.click()}>入力ログ</button><button className="mobile-only" onClick={() => setMobilePanel("options")}>Options</button></div>
        </div>
        <div className="canvas-frame"><ChartCanvas chart={chart} replay={replay} time={time} hiSpeed={hiSpeed} offsetMs={offsetMs} side={side} sourceSide={sourceSide} showInputs={showInputs} hidePassed={hidePassed} />{!chart && <div className="canvas-empty"><button onClick={() => chartInput.current?.click()}>BMS / BMEを開く</button><button className="quiet" onClick={loadDemo}>デモ譜面を表示</button></div>}</div>
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
        <section className="option-group green-option"><div className="option-heading"><h3>緑数字</h3><button className="reset" onClick={() => setHiSpeed(1)}>Reset</button><output>HS: {hiSpeed.toFixed(2)}</output></div><div className="slider-row"><input aria-label="緑数字" type="range" min={100} max={1500} step={1} value={clamp(Math.round(green), 100, 1500)} onChange={event => setHiSpeed(hiSpeedFor(bpm, Number(event.target.value)))} /><input aria-label="緑数字 数値" type="number" min={100} max={9999} value={Math.round(green)} onChange={event => { const value = Number(event.target.value); if (value >= 100 && value <= 9999) setHiSpeed(hiSpeedFor(bpm, value)); }} /></div><p className="green-description">表示時間 {Math.round(green / .6)} ms · IIDX基準</p></section>
        <hr />
        <section className="option-group"><h3>Playside</h3><div className="segmented" role="group" aria-label="プレイサイド">{(["1P", "2P"] as const).map(value => <button key={value} aria-pressed={side === value} onClick={() => setSide(value)}>{value}</button>)}</div></section>
        <section className="option-group"><h3>Visual</h3><label className="check-row"><input type="checkbox" checked={hidePassed} onChange={event => setHidePassed(event.target.checked)} />判定ラインでオブジェクトを消す</label><label className="check-row"><input type="checkbox" checked={showInputs} onChange={event => setShowInputs(event.target.checked)} />打鍵ログを重ねて表示</label></section>
        <section className="option-group"><div className="option-heading"><h3>入力補正</h3><button className="reset" onClick={() => setOffsetMs(0)}>Reset</button><output>ms</output></div><div className="slider-row"><input aria-label="入力補正" type="range" min={-500} max={500} step={1} value={clamp(offsetMs, -500, 500)} onChange={event => setOffsetMs(Number(event.target.value))} /><input aria-label="入力補正 数値" type="number" min={-60000} max={60000} step={1} value={offsetMs} onChange={event => setOffsetMs(clamp(Number(event.target.value), -60000, 60000))} /></div></section>
        <details className="log-details"><summary>入力ログ{replay ? " · " + pressedCount + " presses" : ""}</summary><button onClick={() => replayInput.current?.click()}>JSONを開く</button><p className="muted">{replayName || "未読込"}</p><label>記録元 <select aria-label="ログの入力サイド" value={sourceSide} onChange={event => setSourceSide(event.target.value as PlaySide)}><option>1P</option><option>2P</option></select></label><p className="muted">黄色の枠が押下タイミングです。</p></details>
      </aside>
    </div>
    <footer>BMKeyLogger · <a href="https://textage-chart-viewer.vercel.app/chart/12/_mei/a/sp" target="_blank" rel="noreferrer">TexTage Chart Viewer</a> を参考にした譜面・打鍵ビューアー</footer>
  </main>;
}

export default App;
