'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'wechat-radar-theme-v1';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  const title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <button
      type="button"
      className="control-surface inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      onClick={toggle}
      aria-label={title}
      title={title}
    >
      <Icon size={15} />
    </button>
  );
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  for (const [key, value] of Object.entries(theme === 'dark' ? DARK_VARS : LIGHT_VARS)) {
    document.documentElement.style.setProperty(key, value);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

const LIGHT_VARS = {
  '--bg': '#f1efea',
  '--bg-2': '#e8e5de',
  '--surface': '#faf9f6',
  '--surface-2': '#f1eee8',
  '--surface-3': '#e5dfd6',
  '--border': '#d8d2c8',
  '--border-soft': 'rgba(46, 42, 34, 0.12)',
  '--text': '#171814',
  '--text-2': '#5e6459',
  '--text-3': '#8b8b80',
  '--accent': '#28745b',
  '--accent-2': '#3a9d71',
  '--accent-soft': 'rgba(40, 116, 91, 0.12)',
  '--warn': '#9c6728',
  '--warn-soft': 'rgba(156, 103, 40, 0.12)',
  '--danger': '#b34242',
  '--danger-soft': 'rgba(179, 66, 66, 0.12)',
  '--shadow': '0 18px 55px rgba(55, 47, 34, 0.09)',
  '--chrome-bg': 'rgba(250, 249, 246, 0.86)',
  '--sidebar-bg': 'rgba(248, 246, 239, 0.92)',
  '--control-bg': 'rgba(250, 249, 246, 0.78)',
  '--input-scheme': 'light',
};

const DARK_VARS = {
  '--bg': '#080b0a',
  '--bg-2': '#0d1110',
  '--surface': '#111511',
  '--surface-2': '#171c17',
  '--surface-3': '#20261f',
  '--border': '#293029',
  '--border-soft': 'rgba(175, 190, 167, 0.13)',
  '--text': '#eef2eb',
  '--text-2': '#b6bdb1',
  '--text-3': '#80887d',
  '--accent': '#7dd3a8',
  '--accent-2': '#46b978',
  '--accent-soft': 'rgba(125, 211, 168, 0.13)',
  '--warn': '#d5a253',
  '--warn-soft': 'rgba(213, 162, 83, 0.14)',
  '--danger': '#df6b6b',
  '--danger-soft': 'rgba(223, 107, 107, 0.14)',
  '--shadow': '0 18px 48px rgba(0, 0, 0, 0.34)',
  '--chrome-bg': 'rgba(8, 11, 10, 0.84)',
  '--sidebar-bg': 'rgba(8, 11, 10, 0.9)',
  '--control-bg': 'rgba(17, 22, 18, 0.86)',
  '--input-scheme': 'dark',
};
