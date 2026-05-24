'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { PieChart } from 'lucide-react';
import type { EChartsOption } from 'echarts';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export interface CategoryStat {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  group_count: number;
  message_count: number;
}

type Mode = 'donut' | 'ring' | 'bar' | 'radar';
const MODES: { key: Mode; label: string }[] = [
  { key: 'donut', label: '同心环' },
  { key: 'ring', label: '圆环' },
  { key: 'bar', label: '柱状' },
  { key: 'radar', label: '雷达' },
];

export default function CategoryChart({ categories }: { categories: CategoryStat[] }) {
  const [mode, setMode] = useState<Mode>('bar');

  const totalGroups = categories.reduce((s, c) => s + c.group_count, 0);

  const option = useMemo<EChartsOption>(() => {
    const data = categories
      .filter((c) => c.group_count > 0)
      .map((c) => ({
        name: c.name,
        value: c.group_count,
        itemStyle: { color: c.color },
      }));

    const baseTooltip = {
      backgroundColor: '#101812',
      borderColor: '#27342c',
      textStyle: { color: '#edf1e8' },
    } as const;

    if (mode === 'bar') {
      return {
        grid: { top: 8, right: 24, bottom: 8, left: 80 },
        tooltip: { trigger: 'item', ...baseTooltip },
        xAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: 'rgba(154,174,158,0.12)' } },
          axisLabel: { color: '#737f75', fontSize: 10 },
        },
        yAxis: {
          type: 'category',
          data: data.map((d) => d.name),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#aab4aa', fontSize: 11 },
        },
        series: [
          {
            type: 'bar',
            data,
            barWidth: 12,
            label: { show: true, position: 'right', color: '#aab4aa', fontSize: 10 },
          },
        ],
      };
    }

    if (mode === 'donut' || mode === 'ring') {
      const radius = mode === 'donut' ? ['38%', '70%'] : ['55%', '70%'];
      return {
        tooltip: { trigger: 'item', ...baseTooltip },
        legend: {
          orient: 'vertical',
          right: 8,
          top: 'middle',
          textStyle: { color: '#aab4aa', fontSize: 10 },
        },
        series: [
          {
            type: 'pie',
            radius,
            center: ['38%', '50%'],
            data,
            label: { show: false },
            labelLine: { show: false },
          },
        ],
      };
    }

    return {
      tooltip: baseTooltip,
      radar: {
        center: ['50%', '54%'],
        radius: 88,
        indicator: data.map((d) => ({
          name: d.name,
          max: Math.max(...data.map((x) => x.value), 1),
        })),
        axisName: { color: '#aab4aa', fontSize: 10 },
        splitLine: { lineStyle: { color: '#27342c' } },
        splitArea: { areaStyle: { color: ['rgba(16,24,18,0.42)'] } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: data.map((d) => d.value),
              areaStyle: { color: 'rgba(125,211,168,0.2)' },
              lineStyle: { color: '#7dd3a8' },
              itemStyle: { color: '#7dd3a8' },
            },
          ],
        },
      ],
    };
  }, [categories, mode]);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <PieChart size={14} className="text-[var(--accent)]" />
          分类构成
        </div>
        <div className="text-[11px] text-[var(--text-3)]">
          {categories.length} 类 · {totalGroups} 群
        </div>
      </div>

      <div className="mb-2 flex gap-1 text-[11px]">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === m.key
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {categories.length > 0 ? (
        <ReactECharts option={option} style={{ height: 280 }} />
      ) : (
        <div className="flex h-[280px] items-center justify-center text-[12px] text-[var(--text-3)]">
          暂无分类数据
        </div>
      )}
    </div>
  );
}
