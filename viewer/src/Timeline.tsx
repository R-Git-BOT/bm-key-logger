import { useMemo } from "react";
import { beatToSeconds } from "./bms";
import { formatTime } from "./viewer-model";
import type { Chart } from "./types";

export default function Timeline({ chart, time, duration, onSeek }: { chart: Chart | null; time: number; duration: number; onSeek: (seconds: number) => void }) {
  const bins = useMemo(() => {
    const count = 100;
    const data = Array.from({ length: count }, () => ({ all: 0, scratch: 0 }));
    if (chart && duration > 0) for (const note of chart.notes) {
      const bin = data[Math.min(count - 1, Math.floor(beatToSeconds(chart, note.beat) / duration * count))];
      bin.all++; if (note.lane === 0) bin.scratch++;
    }
    const peak = Math.max(1, ...data.map(bin => bin.all));
    return data.map(bin => ({ all: bin.all / peak * 100, scratch: bin.scratch / peak * 100 }));
  }, [chart, duration]);
  return <div className="timeline">
    <div className="density">
      {bins.map((bin, index) => <div className="density-bin" key={index}><i style={{ height: `${bin.all}%` }} /><b style={{ height: `${bin.scratch}%` }} /></div>)}
      <div className="timeline-cursor" style={{ left: `${duration ? time / duration * 100 : 0}%` }} />
      <input aria-label="再生位置" type="range" min={0} max={duration || 1} step={.001} value={time} onChange={event => onSeek(Number(event.target.value))} disabled={!chart} />
    </div>
    <div className="timeline-labels"><span>{formatTime(time)}</span><span>{formatTime(duration)}</span></div>
  </div>;
}
