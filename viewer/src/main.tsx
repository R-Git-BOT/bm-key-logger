import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { beatToSeconds, parseBms, parseReplay, secondsToBeat } from "./bms";
import type { Chart, Replay } from "./types";
import "./styles.css";

const LANE_NAMES = ["SCR", "1", "2", "3", "4", "5", "6", "7"];
const COLORS = ["#eab457", "#e9edf5", "#78a9ff", "#e9edf5", "#78a9ff", "#e9edf5", "#78a9ff", "#e9edf5"];

function displayLane(rawLane: number) {
  // BMKeyLogger's 1P event order is SCR-/SCR+, then keys 1 through 7.
  if (rawLane === 0 || rawLane === 1) return 0;
  if (rawLane >= 2 && rawLane <= 8) return rawLane - 1;
  return null;
}

function currentBpm(chart: Chart, beat: number) {
  return chart.bpmPoints.filter((point) => point.beat <= beat).at(-1)?.bpm ?? chart.initialBpm;
}

function ChartCanvas({ chart, replay, time, greenNumber, offsetMs }: { chart: Chart; replay: Replay | null; time: number; greenNumber: number; offsetMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const beat = secondsToBeat(chart, Math.max(0, time));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#0a0d13";
    context.fillRect(0, 0, width, height);
    const left = 40;
    const laneWidth = Math.min(76, (width - left - 16) / 8);
    const playfieldWidth = laneWidth * 8;
    const judgementY = height * 0.76;
    const pxPerBeat = Math.max(34, (greenNumber / Math.max(1, currentBpm(chart, beat))) * 7.6);
    context.fillStyle = "#111823";
    context.fillRect(left, 0, playfieldWidth, height);
    for (let lane = 0; lane <= 8; lane += 1) {
      context.strokeStyle = "#273143";
      context.lineWidth = lane === 0 || lane === 8 ? 2 : 1;
      context.beginPath(); context.moveTo(left + lane * laneWidth, 0); context.lineTo(left + lane * laneWidth, height); context.stroke();
    }
    for (const measure of chart.measureStarts) {
      const y = judgementY - (measure - beat) * pxPerBeat;
      if (y < -2 || y > height + 2) continue;
      context.strokeStyle = "#6e7791";
      context.lineWidth = 1.5;
      context.beginPath(); context.moveTo(left, y); context.lineTo(left + playfieldWidth, y); context.stroke();
      context.fillStyle = "#8d9ab2";
      context.font = "11px ui-monospace, monospace";
      context.fillText(String(Math.round(measure / 4) + 1), 5, y + 4);
    }
    for (const note of chart.notes) {
      const y = judgementY - (note.beat - beat) * pxPerBeat;
      if (y < -20 || y > height + 20) continue;
      const gap = 5;
      context.fillStyle = COLORS[note.lane];
      context.shadowColor = COLORS[note.lane];
      context.shadowBlur = 9;
      context.fillRect(left + note.lane * laneWidth + gap, y - 5, laneWidth - gap * 2, 10);
      context.shadowBlur = 0;
    }
    if (replay) {
      for (const input of replay.events) {
        const lane = displayLane(input.lane);
        if (!input.pressed || lane === null) continue;
        const inputSeconds = input.tUs / 1_000_000 + offsetMs / 1000;
        const inputBeat = secondsToBeat(chart, Math.max(0, inputSeconds));
        const y = judgementY - (inputBeat - beat) * pxPerBeat;
        if (y < -10 || y > height + 10) continue;
        context.fillStyle = "#fb4d84";
        context.beginPath();
        context.arc(left + lane * laneWidth + laneWidth / 2, y, 5, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.strokeStyle = "#f5d478";
    context.lineWidth = 3;
    context.beginPath(); context.moveTo(left, judgementY); context.lineTo(left + playfieldWidth, judgementY); context.stroke();
    context.fillStyle = "#b7c4dc";
    context.font = "12px ui-monospace, monospace";
    for (let lane = 0; lane < 8; lane += 1) context.fillText(LANE_NAMES[lane], left + lane * laneWidth + laneWidth / 2 - 8, height - 14);
  }, [chart, replay, time, greenNumber, offsetMs, beat]);
  return <canvas className="chart-canvas" ref={ref} aria-label="譜面表示" />;
}

function App() {
  const [chart, setChart] = useState<Chart | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [greenNumber, setGreenNumber] = useState(300);
  const [offsetMs, setOffsetMs] = useState(0);
  const previous = useRef<number | null>(null);
  const duration = chart ? beatToSeconds(chart, chart.durationBeat) : 0;
  useEffect(() => {
    if (!isPlaying || !chart) { previous.current = null; return; }
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = previous.current === null ? 0 : (now - previous.current) / 1000;
      previous.current = now;
      setTime((old) => {
        const next = Math.min(duration, old + elapsed * rate);
        if (next >= duration) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, chart, duration, rate]);
  const currentBeat = chart ? secondsToBeat(chart, time) : 0;
  const onChartFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setChart(parseBms(await file.arrayBuffer())); setTime(0); setPlaying(false);
  }, []);
  const onReplayFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setReplay(parseReplay(JSON.parse(await file.text())));
  }, []);
  const loadDemo = useCallback(async () => {
    const response = await fetch("demo.bms");
    setChart(parseBms(await response.arrayBuffer())); setTime(0); setPlaying(false);
  }, []);
  const status = useMemo(() => chart ? `${chart.notes.length.toLocaleString()} notes · BPM ${currentBpm(chart, currentBeat).toFixed(0)}` : "BMS/BME を読み込んでください", [chart, currentBeat]);
  return <main>
    <header><div><p className="eyebrow">BM KEY DISPLAY</p><h1>Chart Laboratory</h1></div><p className="status">{status}</p></header>
    <section className="workspace">
      <div className="playfield">
        {chart ? <ChartCanvas chart={chart} replay={replay} time={time} greenNumber={greenNumber} offsetMs={offsetMs} /> : <div className="empty">BMS / BME を選ぶと、ここで譜面を再生できます。</div>}
        <div className="transport"><button onClick={() => setPlaying((value) => !value)} disabled={!chart}>{isPlaying ? "一時停止" : "再生"}</button><button onClick={() => setTime(0)} disabled={!chart}>先頭へ</button><input aria-label="再生位置" type="range" min="0" max={Math.max(duration, 1)} step="0.001" value={time} onChange={(event) => setTime(Number(event.target.value))} disabled={!chart}/><span>{time.toFixed(2)} / {duration.toFixed(2)} sec</span></div>
      </div>
      <aside>
        <section className="card"><h2>データ</h2><button className="demo" onClick={loadDemo}>デモ譜面を表示</button><label className="file">BMS / BME<input type="file" accept=".bms,.bme,.bml,text/plain" onChange={(event) => onChartFile(event.target.files?.[0])}/></label><label className="file">入力ログ JSON<input type="file" accept="application/json,.json" onChange={(event) => onReplayFile(event.target.files?.[0])}/></label>{chart && <dl><div><dt>曲名</dt><dd>{chart.title}</dd></div><div><dt>譜面</dt><dd>{chart.subtitle || chart.level || "—"}</dd></div><div><dt>入力</dt><dd>{replay ? `${replay.events.filter((event) => event.pressed).length} presses` : "未読込"}</dd></div></dl>}</section>
        <section className="card"><h2>再生</h2><label>速度 <output>{rate.toFixed(1)}×</output><input type="range" min="0.1" max="2" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))}/></label><label>緑数字 <output>{greenNumber}</output><input type="range" min="120" max="600" step="5" value={greenNumber} onChange={(event) => setGreenNumber(Number(event.target.value))}/></label><label>入力補正 <output>{offsetMs > 0 ? "+" : ""}{offsetMs} ms</output><input type="range" min="-500" max="500" step="1" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value))}/></label></section>
        <section className="card"><h2>オーバーレイ</h2><p>桃色の丸は保存した押下時刻です。譜面と重なるように「入力補正」を動かして、タイミングのずれを確認します。</p>{replay?.syncMarkersUs.length ? <p className="hint">小節線マーカー {replay.syncMarkersUs.length} 件を読込済みです。自動対応付けは次段階で追加します。</p> : null}</section>
      </aside>
    </section>
  </main>;
}

export default App;

createRoot(document.getElementById("root")!).render(<App />);
