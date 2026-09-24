// ─────────────────────────────────────────────
// SLIDER KEYS (chart overlays with role="slider")
// ─────────────────────────────────────────────

export interface SliderSteps {
  /** Arrow-key step; arrows snap to multiples of it (12:03 → 12:10 → 12:20). */
  step: number;
  /** Page Up/Down step (unsnapped); without it Page Up/Down are not handled. */
  page?: number;
  min: number;
  max: number;
}

/**
 * Value after pressing `key` on a slider at `value`, clamped to [min, max]: arrows right/up and left/down
 * step to the next multiple of `step`, Page Up/Down add/subtract `page`, Home/End jump to min/max.
 * null for keys the slider does not handle.
 */
export function stepValue(key: string, value: number, { step, page, min, max }: SliderSteps): number | null {
  let next: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = (Math.floor(value / step + 1e-9) + 1) * step;
      break;
    case 'ArrowLeft':
    case 'ArrowDown':
      next = (Math.ceil(value / step - 1e-9) - 1) * step;
      break;
    case 'PageUp':
    case 'PageDown':
      if (page === undefined) return null;
      next = key === 'PageUp' ? value + page : value - page;
      break;
    case 'Home':
      next = min;
      break;
    case 'End':
      next = max;
      break;
    default:
      return null;
  }
  return Math.min(max, Math.max(min, next));
}
