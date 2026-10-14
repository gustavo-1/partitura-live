let ctx: AudioContext | null = null;

/** AudioContext compartilhado (criado sob demanda). */
export function audioCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

/** Deve ser chamado dentro de um gesto do usuário (clique/toque) em navegadores móveis. */
export async function resumeAudio(): Promise<AudioContext> {
  const c = audioCtx();
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      /* ignora */
    }
  }
  return c;
}

export function now(): number {
  return ctx ? ctx.currentTime : performance.now() / 1000;
}
