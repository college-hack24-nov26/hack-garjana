/**
 * What a design is, for each component: the parameters you can edit in the
 * Design Lab, their ranges, the material catalog and the engineering inputs
 * (loads and limits) the estimates are checked against.
 *
 * Material numbers are typical handbook values, rounded. They're here so the
 * estimates have something sensible to work with. They are not supplier data.
 */

export type ComponentId = 'brake-caliper' | 'spark-plug';
export type Slot = 'A' | 'B';

export interface ParamSpec<K extends string> {
  key: K;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  hint?: string;
}

/* ------------------------------------------------------------------ */
/*  Brake caliper                                                      */
/* ------------------------------------------------------------------ */

export interface CaliperMaterial {
  id: string;
  name: string;
  densityKgM3: number;
  /** Young's modulus, MPa. */
  eMPa: number;
  /** 0.2 % proof / yield strength, MPa. */
  yieldMPa: number;
}

export const CALIPER_MATERIALS: CaliperMaterial[] = [
  { id: 'gjs-400-18', name: 'EN-GJS-400-18 ductile (spheroidal graphite) cast iron', densityKgM3: 7100, eMPa: 169_000, yieldMPa: 240 },
  { id: 'a356-t6', name: 'A356.0-T6 cast aluminium', densityKgM3: 2680, eMPa: 72_400, yieldMPa: 165 },
  { id: '6061-t6', name: '6061-T6 wrought aluminium (machined billet)', densityKgM3: 2700, eMPa: 68_900, yieldMPa: 276 },
];

export interface CaliperDesign {
  revision: string;
  materialId: string;
  legWallMm: number;
  bridgeMm: number;
  bodyHeightMm: number;
  slotDepthFrac: number;
  bodyLengthMm: number;
  discSlotMm: number;
  ribCount: number;
  ribMm: number;
  pistonBoreMm: number;
  pistonsPerSide: number;
}

export type CaliperKey = Exclude<keyof CaliperDesign, 'revision' | 'materialId'>;

export const CALIPER_PARAMS: ParamSpec<CaliperKey>[] = [
  { key: 'legWallMm', label: 'Leg wall thickness', unit: 'mm', min: 8, max: 32, step: 0.5, digits: 1, hint: 'Thickness of each caliper half (the leg that carries the pistons).' },
  { key: 'bridgeMm', label: 'Bridge thickness', unit: 'mm', min: 8, max: 32, step: 0.5, digits: 1, hint: 'The section that spans the disc and holds the two halves together.' },
  { key: 'bodyHeightMm', label: 'Body height (radial)', unit: 'mm', min: 70, max: 120, step: 1, digits: 0 },
  { key: 'slotDepthFrac', label: 'Disc slot depth fraction', unit: '–', min: 0.4, max: 0.8, step: 0.01, digits: 2, hint: 'How far the disc slot reaches into the body height. The pads sit halfway down it.' },
  { key: 'bodyLengthMm', label: 'Body length (tangential)', unit: 'mm', min: 100, max: 180, step: 1, digits: 0 },
  { key: 'discSlotMm', label: 'Disc slot width', unit: 'mm', min: 26, max: 44, step: 0.5, digits: 1, hint: 'Disc thickness plus both pads and running clearance.' },
  { key: 'ribCount', label: 'Bridge rib count', unit: '–', min: 0, max: 4, step: 1, digits: 0 },
  { key: 'ribMm', label: 'Rib thickness', unit: 'mm', min: 4, max: 14, step: 0.5, digits: 1 },
  { key: 'pistonBoreMm', label: 'Piston bore', unit: 'mm', min: 28, max: 54, step: 1, digits: 0, hint: 'Also drives the clamp force in the Experiment and the Digital Twin.' },
  { key: 'pistonsPerSide', label: 'Pistons per side', unit: '–', min: 1, max: 3, step: 1, digits: 0 },
];

export const CALIPER_BASELINE: CaliperDesign = {
  revision: 'BC-A rev 1.0',
  materialId: 'gjs-400-18',
  legWallMm: 20,
  bridgeMm: 20,
  bodyHeightMm: 95,
  slotDepthFrac: 0.62,
  bodyLengthMm: 130,
  discSlotMm: 34,
  ribCount: 2,
  ribMm: 8,
  pistonBoreMm: 38,
  pistonsPerSide: 2,
};

export interface CaliperInputs {
  linePressureMPa: number;
  allowableStressMPa: number;
  allowableMouthMm: number;
  minWallMm: number;
  minFoS: number;
  padHeightMm: number;
}

export const CALIPER_INPUT_SPECS: ParamSpec<keyof CaliperInputs>[] = [
  { key: 'linePressureMPa', label: 'Hydraulic line pressure', unit: 'MPa', min: 2, max: 18, step: 0.5, digits: 1, hint: 'Design load case: the pressure the caliper must hold.' },
  { key: 'allowableStressMPa', label: 'Allowable von Mises stress', unit: 'MPa', min: 40, max: 300, step: 5, digits: 0 },
  { key: 'allowableMouthMm', label: 'Allowable mouth opening', unit: 'mm', min: 0.03, max: 0.4, step: 0.01, digits: 2, hint: 'How far the two halves may spread under the clamp load. More opening means a longer pedal.' },
  { key: 'minWallMm', label: 'Minimum manufacturable wall', unit: 'mm', min: 3, max: 14, step: 0.5, digits: 1 },
  { key: 'minFoS', label: 'Minimum factor of safety on yield', unit: '–', min: 1, max: 3, step: 0.05, digits: 2, hint: "Checked against the selected material's own yield strength." },
  { key: 'padHeightMm', label: 'Pad radial height', unit: 'mm', min: 30, max: 80, step: 1, digits: 0, hint: 'The disc slot has to be at least this deep to hold the pads.' },
];

export const CALIPER_INPUT_DEFAULTS: CaliperInputs = {
  linePressureMPa: 10,
  allowableStressMPa: 165,
  allowableMouthMm: 0.15,
  minWallMm: 7,
  minFoS: 1.5,
  padHeightMm: 50,
};

/* ------------------------------------------------------------------ */
/*  Spark plug                                                         */
/* ------------------------------------------------------------------ */

export interface ConductorMaterial {
  id: string;
  name: string;
  /** Effective thermal conductivity around 500 °C, W/(m·K). */
  kWmK: number;
}

export const INSULATOR_MATERIALS: ConductorMaterial[] = [
  { id: 'al2o3-95', name: 'Alumina ceramic, 95 %', kWmK: 12 },
  { id: 'al2o3-995', name: 'Alumina ceramic, 99.5 %', kWmK: 16 },
];

export const ELECTRODE_MATERIALS: ConductorMaterial[] = [
  { id: 'ni-cu', name: 'Nickel alloy with copper core', kWmK: 120 },
  { id: 'ni', name: 'Nickel alloy, solid', kWmK: 20 },
];

export interface PlugDesign {
  revision: string;
  insulatorId: string;
  electrodeId: string;
  noseLengthMm: number;
  noseDiaMm: number;
  electrodeDiaMm: number;
  protrusionMm: number;
}

export type PlugKey = Exclude<keyof PlugDesign, 'revision' | 'insulatorId' | 'electrodeId'>;

export const PLUG_PARAMS: ParamSpec<PlugKey>[] = [
  { key: 'noseLengthMm', label: 'Insulator nose length', unit: 'mm', min: 3, max: 15, step: 0.1, digits: 1, hint: 'The main heat-range lever: a longer nose is a longer path to the cooled shell, so the tip runs hotter.' },
  { key: 'noseDiaMm', label: 'Insulator nose Ø', unit: 'mm', min: 4.5, max: 8.5, step: 0.1, digits: 1 },
  { key: 'electrodeDiaMm', label: 'Centre electrode Ø', unit: 'mm', min: 0.6, max: 3, step: 0.1, digits: 1 },
  { key: 'protrusionMm', label: 'Firing-end protrusion', unit: 'mm', min: 0, max: 5, step: 0.1, digits: 1, hint: 'How far the firing end reaches into the chamber.' },
];

/** Same numbers as the plug in the Spark Plug digital twin (REFERENCE_PLUG). */
export const PLUG_BASELINE: PlugDesign = {
  revision: 'SP-A rev 1.0',
  insulatorId: 'al2o3-95',
  electrodeId: 'ni-cu',
  noseLengthMm: 7.5,
  noseDiaMm: 6.2,
  electrodeDiaMm: 2.5,
  protrusionMm: 2,
};

export interface PlugInputs {
  gasTempC: number;
  seatTempC: number;
  hRef: number;
  rpm: number;
  loadPct: number;
  minInsulatorWallMm: number;
}

export const PLUG_INPUT_SPECS: ParamSpec<keyof PlugInputs>[] = [
  { key: 'rpm', label: 'Engine speed (operating point)', unit: 'rpm', min: 800, max: 7000, step: 50, digits: 0 },
  { key: 'loadPct', label: 'Engine load', unit: '%', min: 10, max: 100, step: 5, digits: 0 },
  { key: 'gasTempC', label: 'Cycle-mean gas temperature', unit: '°C', min: 600, max: 1200, step: 10, digits: 0, hint: 'Effective time-averaged gas temperature seen by the firing end.' },
  { key: 'seatTempC', label: 'Shell seat temperature', unit: '°C', min: 100, max: 350, step: 5, digits: 0, hint: 'Where the insulator meets the shell, cooled through the cylinder head.' },
  { key: 'hRef', label: 'Gas-side heat transfer (3000 rpm, full load)', unit: 'W/m²K', min: 400, max: 3000, step: 50, digits: 0 },
  { key: 'minInsulatorWallMm', label: 'Minimum insulator wall', unit: 'mm', min: 0.5, max: 2.5, step: 0.05, digits: 2, hint: 'Ceramic between the centre electrode and the outside of the nose.' },
];

export const PLUG_INPUT_DEFAULTS: PlugInputs = {
  gasTempC: 900,
  seatTempC: 200,
  hRef: 1200,
  rpm: 3000,
  loadPct: 100,
  minInsulatorWallMm: 1,
};

/** Idle condition used by the plug's fouling check. */
export const PLUG_IDLE = { rpm: 800, loadPct: 20 };
/** Full-load speed sweep used by the plug's range check. */
export const PLUG_SWEEP_RPM = { min: 800, max: 7000, step: 100 };

export const TIP_WINDOW_C = { min: 450, max: 850 };

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  'brake-caliper': 'Brake Caliper',
  'spark-plug': 'Spark Plug',
};

export const findMaterial = <T extends { id: string }>(list: T[], id: string) => list.find((m) => m.id === id) ?? list[0];
