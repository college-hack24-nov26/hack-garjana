import { TIP_WINDOW } from '../sim/engineSim.ts';
import { tipColour } from './kinematics.ts';

export type TipStatus = 'none' | 'cold' | 'ok' | 'hot';

/** Is the entered tip temperature below, inside or above the 450-850 °C heat range? */
export function tipStatus(tempC: number | null): TipStatus {
  if (tempC === null) return 'none';
  if (tempC < TIP_WINDOW.selfCleaningC) return 'cold';
  if (tempC > TIP_WINDOW.preIgnitionC) return 'hot';
  return 'ok';
}

export const TIP_STATUS_TEXT: Record<TipStatus, string> = {
  none: 'no data',
  cold: 'below self-cleaning (fouling risk)',
  ok: 'inside heat-range window',
  hot: 'above pre-ignition limit',
};

/** Tip colour, same ramp as AutoTwin. Grey when there's no temperature. */
export const tipColourOrGrey = (tempC: number | null) => (tempC === null ? '#6b7a8c' : tipColour(tempC));
