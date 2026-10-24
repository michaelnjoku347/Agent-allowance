import { useEffect, useState } from 'react';

const KEY = 'allowance-theme';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* Private browsing can block storage. The choice still applies this visit. */
    }
  }, [theme]);

  return [theme, setTheme];
}
