import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinor } from '../lib/format';

/* Swiss chart rules: black bars, one red highlight for what needs attention, no gridlines, no legends
   when a direct label will do, values printed on the bars, thin baseline. Every chart has a text
   alternative (aria-label) and the same numbers are always available in a table next to it. */
const INK = '#0A0A0A', RED = '#D7261E', GREY = '#A1A1AA';
export interface Point { name: string; value: number; hot?: boolean; muted?: boolean }

const short = (minor: number) => { const r = minor / 100; return r >= 1e7 ? `₹${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `₹${(r / 1e3).toFixed(0)}k` : `₹${Math.round(r)}`; };
const colour = (p: Point) => (p.hot ? RED : p.muted ? GREY : INK);
const Tip = ({ money, unit }: { money: boolean; unit?: string }) => <Tooltip cursor={{ fill: '#F4F4F5' }} contentStyle={{ border: '2px solid #0A0A0A', borderRadius: 0, boxShadow: '4px 4px 0 #0A0A0A', fontSize: 12 }}
  formatter={(v: any) => (money ? formatMinor(Number(v)) : `${v}${unit || ''}`)} separator=": " />;

/** Vertical bars. `value` is rupees in minor units when money is true. */
export function BarsChart({ data, money = true, unit, height = 240, summary }: { data: Point[]; money?: boolean; unit?: string; height?: number; summary: string }) {
  if (!data.length) return <div className="empty">Nothing to chart yet.</div>;
  return <div role="img" aria-label={summary} style={{ height, width: '100%' }}><ResponsiveContainer><BarChart data={data} margin={{ top: 22, right: 8, left: 8, bottom: 4 }}>
    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#3F3F46' }} axisLine={{ stroke: INK, strokeWidth: 2 }} tickLine={false} interval={0} />
    <YAxis hide /><Tip money={money} unit={unit} />
    <Bar dataKey="value" maxBarSize={56} isAnimationActive={false}>{data.map((p, i) => <Cell key={i} fill={colour(p)} />)}
      <LabelList dataKey="value" position="top" fontSize={11} fontWeight={700} fill={INK} formatter={(v: any) => (money ? short(Number(v)) : `${v}${unit || ''}`)} /></Bar>
  </BarChart></ResponsiveContainer></div>;
}

/** Horizontal bars for rankings (top vendors, approver turnaround). */
export function HBars({ data, money = true, unit, summary }: { data: Point[]; money?: boolean; unit?: string; summary: string }) {
  if (!data.length) return <div className="empty">Nothing to chart yet.</div>;
  const h = Math.max(120, data.length * 34 + 16);
  return <div role="img" aria-label={summary} style={{ height: h, width: '100%' }}><ResponsiveContainer><BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }}>
    <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: INK }} axisLine={{ stroke: INK, strokeWidth: 2 }} tickLine={false} />
    <Tip money={money} unit={unit} />
    <Bar dataKey="value" barSize={16} isAnimationActive={false}>{data.map((p, i) => <Cell key={i} fill={colour(p)} />)}
      <LabelList dataKey="value" position="right" fontSize={11} fontWeight={700} fill={INK} formatter={(v: any) => (money ? short(Number(v)) : `${v}${unit || ''}`)} /></Bar>
  </BarChart></ResponsiveContainer></div>;
}

/** One proportional bar split into labelled parts: a status mix without a pie chart. */
export function MixBar({ parts, summary }: { parts: { name: string; value: number; tone?: 'ink' | 'red' | 'grey' | 'mid' | 'light' }[]; summary: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="empty">Nothing to chart yet.</div>;
  const fill = { ink: INK, red: RED, grey: '#A1A1AA', mid: '#52525B', light: '#E4E4E7' } as const;
  return <div role="img" aria-label={summary}>
    <div style={{ display: 'flex', height: 28, border: `2px solid ${INK}` }}>{parts.filter((p) => p.value > 0).map((p) => <div key={p.name} title={`${p.name}: ${p.value}`}
      style={{ width: `${(p.value / total) * 100}%`, background: fill[p.tone || 'ink'], borderRight: '2px solid #fff' }} />)}</div>
    <div className="row" style={{ gap: 18, marginTop: 10 }}>{parts.map((p) => <span key={p.name} style={{ fontSize: 12 }}><i style={{ display: 'inline-block', width: 10, height: 10, background: fill[p.tone || 'ink'], marginRight: 6, border: p.tone === 'light' ? '1px solid #A1A1AA' : 0 }} /><b>{p.value}</b> {p.name}</span>)}</div>
  </div>;
}
