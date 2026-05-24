'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { TrendingUp } from 'lucide-react';
import type { EChartsOption } from 'echarts';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export interface TrendPoint {
  date: string;
  count: number;
}

export default function TrendChart({
  data,
  peak,
  avg,
  total,
}: {
  data: TrendPoint[];
  peak: TrendPoint;
  avg: number;
  total: number;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { top: 30, right: 24, bottom: 30, left: 50 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#101812',
        borderColor: '#27342c',
        textStyle: { color: '#edf1e8' },
        formatter: (params: unknown) => {
          const arr = params as Array<{ name: string; value: number }>;
          const p = arr[0];
          return `<div style="font-size:12px"><div style="color:#aab4aa">${p.name}</div><div style="color:#7dd3a8;font-weight:600;margin-top:2px">消息数：${p.value} 条</div></div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date.slice(5)),
        axisLine: { lineStyle: { color: '#27342c' } },
        axisTick: { show: false },
        axisLabel: { color: '#737f75', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(154,174,158,0.12)' } },
        axisLabel: { color: '#737f75', fontSize: 11 },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: data.map((d) => d.count),
          lineStyle: { color: '#7dd3a8', width: 2 },
          itemStyle: { color: '#7dd3a8' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(125,211,168,0.34)' },
                { offset: 1, color: 'rgba(125,211,168,0.02)' },
              ],
            },
          },
        },
      ],
    }),
    [data],
  );

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <TrendingUp size={14} className="text-[var(--accent)]" />
          消息走势
        </div>
        <div className="text-[11px] text-[var(--text-3)]">
          过去 {data.length} 天 · {total.toLocaleString()} 条
        </div>
      </div>

      <div className="mt-2 flex gap-6 text-[11px] text-[var(--text-3)]">
        <span>
          峰值 <span className="text-[var(--text)]">{peak.count} 条/天</span>
          {peak.date && <span className="ml-1 text-[var(--text-3)]">· {peak.date}</span>}
        </span>
        <span>
          均值 <span className="text-[var(--text)]">{avg.toFixed(1)}</span>
        </span>
        <span>
          总计 <span className="text-[var(--text)]">{total.toLocaleString()} 条</span>
        </span>
      </div>

      <div className="mt-2">
        {data.length > 0 ? (
          <ReactECharts option={option} style={{ height: 280 }} />
        ) : (
          <div className="flex h-[280px] items-center justify-center text-[12px] text-[var(--text-3)]">
            暂无数据 · 点击右上「重扫」加载
          </div>
        )}
      </div>
    </div>
  );
}
