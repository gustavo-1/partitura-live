import { useEffect } from 'react';
import { input } from '../audio/input';
import { logPractice } from '../state/progress';

/**
 * Conta tempo de prática enquanto a pessoa está ativa nesta tela (tocando, clicando ou
 * digitando nos últimos 45 s, com a aba visível). Usado em lições e treinos.
 */
export function usePracticeTime(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let lastActive = performance.now();
    let pending = 0;
    let last = performance.now();
    const mark = () => (lastActive = performance.now());
    const offInput = input.on(mark);
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    const t = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (document.visibilityState === 'visible' && now - lastActive < 45_000) pending += dt;
      if (pending >= 15) {
        logPractice(Math.round(pending));
        pending = 0;
      }
    }, 5000);
    return () => {
      clearInterval(t);
      offInput();
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
      if (pending >= 3) logPractice(Math.round(pending));
    };
  }, [enabled]);
}
