/**
 * Builds the InsightContext for the selected component: verdicts from the
 * validation engine, attributions, findings, recommendations and the numbers an
 * explanation is allowed to quote. Pure function of the workspace.
 */
import { CALIPER_MATERIALS, COMPONENT_LABEL, ELECTRODE_MATERIALS, INSULATOR_MATERIALS, findMaterial } from '../workspace/designs.ts';
import type { ComponentId } from '../workspace/designs.ts';
import { caliperEstimate } from '../workspace/estimators.ts';
import { plugContext, validateBoth } from '../workspace/validation.ts';
import type { ValidationSource } from '../workspace/validation.ts';
import type { ExperimentRun } from '../workspace/WorkspaceStore.ts';
import { attributeRules, buildFindings } from './findings.ts';
import { recommendFixes, recommendOpportunity } from './recommendations.ts';
import type { GroundedFact, InsightContext } from './types.ts';

export interface InsightSource extends ValidationSource {
  component: ComponentId;
  runs: ExperimentRun[];
}

function caliperFacts(src: ValidationSource): GroundedFact[] {
  const a = caliperEstimate(src.caliper.A, src.caliperInputs);
  const b = caliperEstimate(src.caliper.B, src.caliperInputs);
  const ma = findMaterial(CALIPER_MATERIALS, src.caliper.A.materialId);
  const mb = findMaterial(CALIPER_MATERIALS, src.caliper.B.materialId);
  const lever = (d: typeof src.caliper.A) => (d.bodyHeightMm * d.slotDepthFrac) / 2;
  return [
    { key: 'clampForce', label: 'Clamp force per side', unit: 'kN', digits: 2, A: a.clampForceN / 1000, B: b.clampForceN / 1000, source: 'estimate' },
    { key: 'leverArm', label: 'Pad-force lever arm from the bridge', unit: 'mm', digits: 1, A: lever(src.caliper.A), B: lever(src.caliper.B), source: 'geometry' },
    { key: 'bridgeMoment', label: 'Bridge bending moment', unit: 'N·m', digits: 0, A: a.bridgeMomentNm, B: b.bridgeMomentNm, source: 'estimate' },
    { key: 'bridgeI', label: 'Bridge second moment of area', unit: 'mm⁴', digits: 0, A: a.bridgeIMm4, B: b.bridgeIMm4, source: 'estimate' },
    { key: 'stress', label: 'Peak bridge stress', unit: 'MPa', digits: 1, A: a.peakStressMPa, B: b.peakStressMPa, source: 'estimate' },
    { key: 'mouth', label: 'Mouth opening', unit: 'mm', digits: 3, A: a.mouthOpeningMm, B: b.mouthOpeningMm, source: 'estimate' },
    { key: 'fos', label: 'Factor of safety on yield', unit: '–', digits: 2, A: a.factorOfSafety, B: b.factorOfSafety, source: 'estimate' },
    { key: 'mass', label: 'Mass', unit: 'kg', digits: 3, A: a.massKg, B: b.massKg, source: 'estimate' },
    { key: 'youngsModulus', label: "Young's modulus", unit: 'GPa', digits: 1, A: ma.eMPa / 1000, B: mb.eMPa / 1000, source: 'material' },
    { key: 'yield', label: 'Yield strength', unit: 'MPa', digits: 0, A: ma.yieldMPa, B: mb.yieldMPa, source: 'material' },
    { key: 'linePressure', label: 'Line pressure (load case)', unit: 'MPa', digits: 1, A: src.caliperInputs.linePressureMPa, B: src.caliperInputs.linePressureMPa, source: 'input' },
  ];
}

function plugFacts(src: ValidationSource): GroundedFact[] {
  const a = plugContext(src.plug.A, src.plugInputs);
  const b = plugContext(src.plug.B, src.plugInputs);
  const k = (list: { id: string; kWmK: number }[], id: string) => findMaterial(list, id).kWmK;
  return [
    { key: 'tip', label: 'Tip temperature at the operating point', unit: '°C', digits: 0, A: a.est.tipTempC, B: b.est.tipTempC, source: 'estimate' },
    { key: 'tipMax', label: 'Hottest tip, full-load sweep', unit: '°C', digits: 0, A: a.sweepMaxC, B: b.sweepMaxC, source: 'estimate' },
    { key: 'tipIdle', label: 'Tip at idle', unit: '°C', digits: 0, A: a.idleC, B: b.idleC, source: 'estimate' },
    { key: 'mL', label: 'Fin parameter m·L', unit: '–', digits: 2, A: a.est.mL, B: b.est.mL, source: 'estimate' },
    { key: 'heat', label: 'Heat to the shell seat', unit: 'W', digits: 1, A: a.est.heatToSeatW, B: b.est.heatToSeatW, source: 'estimate' },
    { key: 'h', label: 'Gas-side heat transfer at the operating point', unit: 'W/m²K', digits: 0, A: a.est.hEff, B: b.est.hEff, source: 'estimate' },
    { key: 'kInsulator', label: 'Insulator conductivity', unit: 'W/m·K', digits: 0, A: k(INSULATOR_MATERIALS, src.plug.A.insulatorId), B: k(INSULATOR_MATERIALS, src.plug.B.insulatorId), source: 'material' },
    { key: 'kElectrode', label: 'Electrode conductivity', unit: 'W/m·K', digits: 0, A: k(ELECTRODE_MATERIALS, src.plug.A.electrodeId), B: k(ELECTRODE_MATERIALS, src.plug.B.electrodeId), source: 'material' },
  ];
}

export function buildInsightContext(src: InsightSource): InsightContext {
  const component = src.component;
  const validation = validateBoth(src, component);
  const fixes = recommendFixes(src, component, validation.B);
  const opportunity = fixes.length ? null : recommendOpportunity(src, component, validation.B);
  const ci = src.caliperInputs;
  const pi = src.plugInputs;
  return {
    component,
    componentLabel: COMPONENT_LABEL[component],
    revisions: { A: validation.A.revision, B: validation.B.revision },
    validation,
    attributions: attributeRules(src, component, validation.B),
    findings: buildFindings(src, component, validation, src.runs),
    recommendations: opportunity ? [opportunity] : fixes,
    facts: component === 'brake-caliper' ? caliperFacts(src) : plugFacts(src),
    designs:
      component === 'brake-caliper'
        ? { A: { ...src.caliper.A }, B: { ...src.caliper.B } }
        : { A: { ...src.plug.A }, B: { ...src.plug.B } },
    inputs: component === 'brake-caliper' ? { ...src.caliperInputs } : { ...src.plugInputs },
    loadCase:
      component === 'brake-caliper'
        ? `${ci.linePressureMPa} MPa line pressure · allowable stress ${ci.allowableStressMPa} MPa · allowable mouth opening ${ci.allowableMouthMm} mm · minimum wall ${ci.minWallMm} mm · minimum factor of safety ${ci.minFoS}`
        : `${pi.rpm} rpm at ${pi.loadPct} % load · gas ${pi.gasTempC} °C · seat ${pi.seatTempC} °C · h ${pi.hRef} W/m²K at 3000 rpm · minimum insulator wall ${pi.minInsulatorWallMm} mm`,
    fidelity:
      component === 'brake-caliper'
        ? 'Reduced-order beam estimate (rigid legs, bridge as a beam), checked against demo limits. Not a finite-element result.'
        : 'Reduced-order fin estimate (nose and electrode as one fin), checked against demo limits. Not a finite-element result.',
  };
}
