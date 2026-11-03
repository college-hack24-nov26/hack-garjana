# AUTOTWIN



**Interactive digital twins of automotive components, running entirely in the browser.**

AutoTwin pairs a live, time-stepped simulation with an interactive 3D model of the
component, so you can change an input and immediately see the part move, the
readings update and the charts redraw. It currently ships three modules:

| Module | Route | What it shows |
|---|---|---|
| **Alloy Wheel** | `#/digital-twin/alloy-wheel` | The 5 Y-spoke wheel from the reference drawing (Ø520 × 256), rolling through turns and stops on a loaded tyre, with tyre-force arrows, live spoke stresses and a per-turn fatigue cycle |
| **Brake Caliper** | `#/brake-caliper` | 5-spoke alloy wheel, Ø330 × 28 mm vented rotor and a fixed opposed caliper with moving pistons and pads, driven by one brake simulation |
| **Spark Plug** | `#/spark-plug` | Inline-4 engine with split A/B spark plugs, slider-crank pistons, firing order and an optional combustion-fire visualisation |

---

## Problem statement

Engineering students and design reviewers usually see components as static CAD
renders, or as plots that are separate from the geometry. It is hard to build an
intuition for *how* a component behaves. Examples:

- how line pressure becomes clamp force, brake torque and rotor heat;
- where each piston is when a cylinder fires.

AutoTwin links the model, the motion and the measurements in one place, and
labels clearly which numbers are inputs, which are derived and which are estimates.

## Key features

- **Real-time 3D models** (Three.js via React Three Fiber). The geometry is generated
  parametrically in code, so it re-sizes from the inputs. There are no pre-recorded
  videos; every frame is computed from the simulation state.
- **One source of truth per module.** A plain-TypeScript simulation object owns the
  state. The 3D scene reads it every frame and the UI reads throttled snapshots, so
  the animation, readings and charts always agree.
- **Alloy Wheel twin:**
  - Geometry built from the reference drawing: Detail B rim profile, Section A-A hub
    and drafted spokes (10° front, 15° back), R15 fork blends, 5× Ø10 ↧55 bolt holes
    with Ø20 counterbores on a 72° pitch, Ø60 centre cap. Every dimension in the
    Design tab is badged *Drawing*, *Interpreted*, *Assumed* or *Derived*.
  - Manoeuvres: handling loop, cruise, steady cornering, brake to a stop, or drive it
    yourself with the arrow keys and Space.
  - Two bench tests: cornering fatigue (bare wheel on a shaft under a rotating
    bending moment) and radial fatigue (tyred wheel on a drum). Each shows estimated
    cycles to failure against a target, with a meets / below-target verdict.
  - Load transfer, a friction-circle grip limit, a pressure-dependent tyre that flattens
    at the contact patch, and Fz/Fy/Fx arrows.
  - Spoke stresses coloured on every vertex (beam estimate, scaled to the fatigue
    strength at 10⁷ cycles), rim hoop stress, and a stress-vs-angle chart of one turn.
  - Wheel mass and inertia from the geometry, for three materials.
  - Section A-A cut, exploded view, and a "Build from drawing" sequence that assembles
    the wheel step by step with the drawing callouts.
  - **Design Lab for the wheel** (pick *Alloy Wheel* in the Design Lab switch): the
    drawing as design A next to candidate B. It has a front-view outline overlay,
    mass, inertia, peak stress in a design turn, and life on both rigs. Four checks
    give PASS / NEEDS REVIEW / FAIL: stress against yield/FoS, the two rig lives,
    and a castable minimum section. "Drive B in twin" loads the candidate into
    the live twin. The wheel keeps its own A/B store (`src/modules/alloyWheel/lab/`),
    separate from the caliper/plug workspace.
- **Brake Caliper twin:**
  - Hydraulic pressure lag, piston and pad travel, and clamp force.
  - Brake torque, tyre-force limit, wheel deceleration and rotor temperature.
  - A cutaway view showing the pistons and pads.
- **Spark Plug twin:**
  - Slider-crank piston motion and the 1-3-4-2 firing order.
  - Stroke labels.
  - Plug geometry inputs.
  - Tip-temperature heat-range window, from 450 to 850 °C.
  - Slow-motion and frame-by-frame time scales.
- **Combustion fire.** A spark flash, a flame front spreading from the plug gap, and
  burned gas cooling through the power stroke. It is driven only by crank angle, so
  it pauses, scrubs and replays exactly. Toggle it with the viewport button,
  the parameters panel or the **F** key.
- **Live telemetry and charts:**
  - Time-axis charts for the brake and the wheel, plus a one-turn stress chart for the wheel.
  - Crank-angle charts for the engine.
  - Hover tooltips on both.
- **Honest labelling.** Every reading carries a badge: *Input*, *Derived*, *Model*,
  *Estimated*, *Demo fixture*, *Drawing* or *Assumed*.
- **Playback control.** Simulated time is separate from wall-clock playback, from
  1/1000× frame-by-frame up to 2×.

## Technology stack

| Layer | Technology |
|---|---|
| UI | React 18, TypeScript 5.6 |
| 3D | three.js 0.169, @react-three/fiber 8, @react-three/drei 9 |
| Shaders | Custom GLSL (combustion fire) |
| Charts | Hand-written canvas line chart (no chart library) |
| Build | Vite 5 |
| Tests | Node ≥ 22 with `--experimental-strip-types` (no test framework needed) |

There is no backend and no database. Everything runs client-side.

## Getting started

Requirements: **Node.js 22 or newer** and npm.

```bash
npm install
npm run dev          # start the dev server at http://localhost:5173
npm run build        # type-check and build for production into dist/
npm run preview      # serve the production build locally
npm test             # brake, engine, workspace, AI Insights and wheel checks
```

Open `http://localhost:5173/`. Every section has its own address: `#/dashboard`,
`#/design-lab`, `#/digital-twin/alloy-wheel`, `#/digital-twin/brake-caliper`, `#/digital-twin/spark-plug`,
`#/ai-insights` and so on.

## AI Insights

AI Insights explains why a design passes or fails, which changed parameter drives
the result, and which change to candidate B would fix it. It runs entirely in the
browser with no external AI service and no API key. Every number is a
reduced-order estimate checked against demo limits, and the page labels it that
way. None of it is a finite-element result.

It is built in three layers, and only the first one can decide a verdict:

| Layer | Files | Job |
|---|---|---|
| 1. Validation engine | `src/workspace/validation.ts` | Deterministic rules: value vs limit gives **PASS**, **NEEDS REVIEW** (inside the limit but within the estimate's uncertainty, or a condition that needs an engineer's look) or **FAIL**, with the signed margin. The Design Lab and Dashboard use the same engine. |
| 2. Rule-based insights | `src/insights/findings.ts`, `recommendations.ts` | A vs B findings. Attribution: each changed parameter is put back to A's value on its own. Recommendations: the smallest single change that clears a check, searched in the parameter's own steps and re-validated, so the predicted verdict is computed. Changes that would break another check are not suggested. |
| 3. Explanation | `src/insights/explain/` | Turns layers 1–2 into text through an `ExplanationProvider`. Today that is `localProvider.ts` (fixed templates, offline). `guardrails.ts` rejects any text with prohibited claims (certification, validation, guarantees, cost savings) or one that contradicts a verdict, and falls back to the local text. |

**Adding a language model later** (for example a free-tier Gemini model):

1. Add `POST /api/insights/explain` to the AutoTwin backend. It takes the
   `InsightContext` JSON (`src/insights/types.ts`) and returns an `Explanation`.
   The model API key stays in the backend's environment and is never shipped to
   the browser.
2. Register a provider in `src/insights/explain/provider.ts` that posts to that
   endpoint.
3. Nothing else changes. Verdicts still come from the validation engine, every
   answer still goes through the guardrails, and the local explanation is shown
   at once while a slower provider answers.

## Architecture

```
            ┌────────────────────────────── Dashboard page ──────────────────────────────┐
            │                                                                            │
 inputs ──▶ │  Parameters panel ──▶  Simulation (BrakeSim / EngineSim)  ◀── SimDriver   │
            │                          single source of truth            (useFrame:     │
            │                               │            │                 the only     │
            │             throttled snapshot│            │ read every      place time   │
            │                   (~15 Hz)    ▼            ▼ frame           advances)    │
            │               Telemetry, KPIs, charts     3D scene                         │
            └────────────────────────────────────────────────────────────────────────────┘
```

- `SimStore` is a small observable base class. Each simulation extends it, and React
  subscribes through `useSyncExternalStore`, throttled so the panels don't re-render
  at frame rate.
- Each 3D scene has a driver component. Its `useFrame` callback is the only place
  simulated time advances. Everything else in the scene reads the state.
- The simulation code is plain TypeScript with no React or three.js imports. That
  keeps it testable in Node, as the `scripts/` checks show.

### Project structure

```
src/
  main.tsx, App.tsx             Entry point and page selection
  app/routes.ts                 Hash routes for every section
  shell/                        App shell (top nav, sidebar), module and component switches
  pages/                        Dashboard, Design Lab, AI Insights (+ shared bits, pages.css)
  workspace/                    A/B designs, estimators, validation engine, metrics, experiments
  insights/                     Findings, recommendations, explanation providers + guardrails
  core/                         SimStore observable base + store-version hook
  ui/                           Panel, Badge, Tabs, sliders, inputs; canvas LineChart
  three/common.tsx              Studio lighting/environment and camera rig shared by the scenes
  three/geometry.ts             Extrude/lathe/annulus helpers shared by the scenes
  styles.css                    Design tokens and dashboard styles
  modules/
    alloyWheel/
      wheel/                    Drawing dimensions + provenance, profiles, Y-spoke outline, mass;
                                materials; build-from-drawing timeline
      sim/                      WheelSim, spoke load path and fatigue cycle, React context/hooks
      three/                    Wheel, tyre, hub, bolts, cap, road, load arrows, section/flatten shaders
      components/               Parameters (with drawing table) and telemetry panels
      AlloyWheelDashboard.tsx
    brakeCaliper/
      sim/                      BrakeSim model + React context/hooks
      three/                    Wheel, rotor, caliper, pistons, pads, hydraulics, cutaway
      components/               Parameters and telemetry panels
      BrakeCaliperDashboard.tsx
    sparkPlug/
      engine/                   Slider-crank kinematics, linkage, heat-range window, combustion timing
      sim/                      EngineSim model + React context/hooks
      three/                    Engine scene, plugs, pistons, rods, crank, fire shader
      components/               Parameters and telemetry panels
      SparkPlugDashboard.tsx
scripts/
  sim-check.ts                  Brake physics checks
  engine-check.ts               Engine kinematics, linkage, simulation and combustion checks
  workspace-check.ts            Estimator trends and workspace store
  insights-check.ts             Verdicts, attribution, recommendations, guardrails, provider fallback
  wheel-check.ts                Drawing dimensions, equilibrium, load transfer, stress trends, fatigue
```

## Simulation model (simplified, illustrative)

**Alloy wheel.** This is a reduced-order hand calculation, not FEA. It models the
front-left wheel of a car:

- Acceleration commands with a 0.3 s lag. Load transfer
  `Fz = Fz0·(1 − 0.39·ax/g + 0.69·ay/g)` uses h = 0.55 m, wheelbase 2.8 m and
  track 1.6 m. The 4500 N static load is a *Demo fixture*, the same as the backend's.
- Tyre forces in proportion to load (`Fx = Fz·ax/g`, `Fy = Fz·ay/g`), capped by the
  friction circle `μ·Fz`. Tyre stiffness rises with pressure, which sets the loaded
  radius; the wheel rolls without slip on `R_e = R − δ/3`.
- Radial load shared between the spokes: half by a rigid-rim cosine law, half
  concentrated near the patch. Vertical equilibrium holds exactly. The moment
  `Fz·d + Fy·R` bends the spokes out of plane with a cosine distribution, and torque
  `Fx·R` bends them in plane.
- Each Y-spoke is treated as a beam from hub to rim with both ends held against
  rotation. Its section comes from the drawn geometry: tapered widths, drafted depth
  20 → 33 mm, and the legs sharing the load past the fork. `Kt` (default 1) is
  applied at the junctions.
- Rim hoop stress `p·r/t` plus `ρω²r²`.
- Fatigue: each spoke sees one cycle per turn, assessed with Basquin, Goodman and
  Miner on illustrative constants. It ranks conditions; it is not a life prediction.
- Test rigs replace the car. Cornering fatigue applies `M = (μ·R + d)·Fv·S` through
  the hub with no tyre (defaults μ 0.7, S 1.6, target 10⁵ cycles), giving a fully
  reversed cycle. Radial fatigue applies `Fr = K·Fv` through the tyre onto a drum
  (defaults K 2.25, target 5×10⁵ cycles). The form follows common wheel-standard
  practice, but the factors and targets are labelled assumptions, not values from
  a standard. The drawn design gives about 5×10⁵ cycles on the cornering rig.

The wheel steps in 2 ms of simulated time. Mass and polar inertia are integrated
exactly from the drawn profiles (11.9 kg in A356-T6). The drawing's title block names
"Alloy Steel"; that material is selectable for comparison. The drawing's centre-cap
emblem is a third-party trademark, so a generic emblem of the same size is used.

**Brake.** This is not a validated brake solver. Per wheel it uses:

- a first-order hydraulic lag;
- piston travel equal to the running clearance (0.15 mm) up to 0.25 MPa contact
  pressure, then linear compliance;
- brake torque `T = 2·μ·F·r_eff`;
- a tyre force capped at `μ_road·m·g` (ideal ABS);
- rolling without slip (`v = ωR`);
- a cruise controller (≤ 3 m/s²) or coast;
- a lumped-capacitance rotor temperature.

The physics integrates in fixed 1 ms steps of *simulated* time. The playback speed
only sets how many simulated seconds are shown per wall-clock second. The running
clearance is drawn 33× larger in 3D so the piston and pad motion is visible.

**Engine.** Exact slider-crank kinematics with the 1-3-4-2 firing order and a rigid
connecting rod on a crank pin. Plug tip temperatures are user-entered values,
labelled *Demo fixture*, and are classified against the 450–850 °C self-cleaning
window.

**Combustion fire** follows typical spark-ignition timing:

- the spark at 18° BTDC;
- the flame front crossing the chamber in about 48°;
- the burned-gas glow fading by about 182° ATDC.

It is an illustrative visual envelope, not a heat-release or flame-propagation model.

## Current limitations

- **No physical solver.** The dynamics are simplified and illustrative. They are not
  validated against test data and should not be used for engineering decisions.
- **Parametric geometry, not imported CAD.** Models are generated in code from
  dimensions. Loading STEP/GLB files is not supported yet.
- **No backend.** Plug tip temperatures are user inputs, not solver results. Nothing
  is persisted between sessions.
- **Desktop-first.** The dashboard layout is designed for laptop and desktop screens.
- The production bundle is a single chunk of over 500 kB, mostly three.js. Vite
  warns about it, and the warning is harmless.

## Roadmap

- Optional CAD import: a GLB display mesh mapped onto the animated part groups.
- A solver back end for meshing and thermal/structural FEA. Its results would replace
  the *Demo fixture* inputs.
- Alloy wheel in Experiment, AI Insights and Reports. The Design Lab already has it,
  through its own A/B store.
- Drive the wheel's stress colours from the backend's scikit-fem field instead of the
  beam estimate.
