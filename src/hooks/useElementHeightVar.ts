// useElementHeightVar.ts
import React, { useLayoutEffect, useRef } from 'react';
import { RO } from './ResizeObserverManager';

type BoxType = 'border-box' | 'content-box';

/**
 * Observes an element's height and writes it to a CSS variable on targetEl.
 * - No React state updates
 * - Reads happen in RO callback; writes are batched in next rAF
 * - Uses entry.borderBoxSize when available (no layout reads)
 * - Global manager disconnects all observers during window resize
 */
export function useElementHeightVar(
  observedRef: React.RefObject<HTMLElement>,
  cssVarName: string,
  {
    targetEl,
    box = 'border-box' as BoxType,
    precision = 0.5,
  }: {
    targetEl: HTMLElement | null | undefined;
    box?: BoxType;
    precision?: number;
  }
) {
  const last = useRef(-1);
  const writing = useRef(false);

  useLayoutEffect(() => {
    const el = observedRef.current;
    const tgt = targetEl ?? null;
    if (!el || !tgt) return;

    const ro = new ResizeObserver(([entry]) => {
      if (writing.current) return; // ignore our own write pass

      // read from entry only (no layout reads)
      let h: number | undefined;
      const sizes: any = box === 'border-box' ? entry.borderBoxSize : entry.contentBoxSize;
      if (sizes && sizes.length) h = sizes[0].blockSize ?? sizes[0].inlineSize;
      if (h == null) h = el.offsetHeight;

      const rounded = Math.round(h / precision) * precision;
      if (rounded === last.current) return;
      last.current = rounded;

      requestAnimationFrame(() => {
        writing.current = true;
        tgt.style.setProperty(cssVarName, `${rounded}px`);
        queueMicrotask(() => (writing.current = false));
      });
    });

    const unregister = RO.register(ro, el, { box });
    return () => {
      unregister();
      if (tgt) tgt.style.removeProperty(cssVarName);
    };
  }, [observedRef, targetEl, cssVarName, box, precision]);
}
