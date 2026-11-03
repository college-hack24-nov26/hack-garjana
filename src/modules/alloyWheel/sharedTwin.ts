/**
 * The one WheelSim and build clock for the whole session, shared by the twin
 * page and the Design Lab (which can send a design to the twin).
 */
import { WheelSim } from './sim/wheelModel';
import { BuildClock } from './wheel/build';

let shared: { sim: WheelSim; clock: BuildClock } | null = null;

export function getWheelTwin() {
  if (!shared) {
    shared = { sim: new WheelSim(), clock: new BuildClock() };
    shared.sim.play();
    if (import.meta.env.DEV) (window as unknown as { __wheelSim: WheelSim }).__wheelSim = shared.sim;
  }
  return shared;
}
