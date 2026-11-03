# AutoTwin UI redesign: audit

Date: 2026-11-04. Scope: the web frontend in `src/` (the `Backend/` FastAPI service was inspected only for what the UI can truthfully claim).
The code is the source of truth. The brief described five screenshots, but only two arrived (Brake Caliper twin, original sidebar), so the per-screen notes below combine those, the brief's descriptions, and fresh screenshots of every route.

## 1. Architecture

| Area | What exists |
|---|---|
| Build | Vite 5, React 18.3, TypeScript 5.6 (`npm run dev`, `npm run build`), no CSS framework |
| Routing | Hash routing in `src/app/routes.ts` (`#/section` and `#/digital-twin/<module>`), no router library |
| Shell | `src/shell/AppShell.tsx`: rail, top bar, status chips, command palette |
| State | Plain stores outside React with `useSyncExternalStore`: `workspace/WorkspaceStore.ts` (designs A/B, runs, activity), `core/SimStore.ts`, `api/solverRun.ts` (backend jobs, survives reloads) |
| Backend | FastAPI (`Backend/backend/app`). The UI calls it via `src/api/client.ts`: health, component profiles, design studies (CadQuery → Gmsh → scikit-fem), validation, LLM chat |
| 3D | React Three Fiber 8 + drei. Four `<Canvas>`es: Brake (`BrakeScene`), Spark plug (`EngineCanvas`), Alloy wheel (`WheelScene`), AI Insights focus viewer (`FocusViewer`). All `dpr={[1, 2]}`, 31 `useFrame` loops, geometry generated in code (no external model files) |
| Styling | `styles.css` (tokens + shared classes), `pages/pages.css`, per-feature CSS (`analytics.css`, `insights.css`, `solver.css`, `wheel.css`), and now `theme/theme.css` |
| Charts | Canvas 2D `LineChart`, SVG `ABChart` |

## 2. Route inventory (implementation status from code)

| Route | Implemented | Partial | Not implemented |
|---|---|---|---|
| Dashboard | Workspace stats from the store, component tiles with A/B verdicts, workflow strip, recent activity, "What's real in this build" table | Stats cover two of the three components (the wheel has no Design Lab model) | Recent reports feed |
| Design Lab | A/B parametric editing for brake caliper and spark plug, materials, copy A to B, reset, steady-state reduced-order estimates, rule checks, "how far can these be trusted" warning | No alloy wheel. Undo/redo is not implemented | 3D geometry preview (none exists, so none was added) |
| Experiment | Protocols (single stop, repeated stops, pressure sweep for the caliper; speed/load sweeps for the plug), A/B run records, charts, backend "Run on solver" panel with real job states | Reduced-order runs are synchronous, so they have no queued/running state; only backend jobs do | |
| Digital Twin | Three live twins: brake (lumped dynamics), spark plug (slider-crank kinematics, illustrative), alloy wheel (reduced-order load path, rig modes). View presets, cutaway, tyre, explode/build (wheel), telemetry with provenance badges | Part selection and focus levels exist only in AI Insights (`FocusViewer`), not in the twins | Isolate/hide-part tools |
| Analytics | Parameter sweeps of A vs B for every result, "only parameters that differ" filter, CSV | | |
| Compare | **Removed at the user's request** (another work stream, 2026-11-04). Not re-added | | |
| AI Insights | Rule-based findings and recommendations, a chat (local engine, plus Groq when configured), a focus viewer with part levels | | |
| Reports | Printable report sheet built from workspace data | | |

## 3. Visual problems found (before)

| # | Where | Problem | Severity |
|---|---|---|---|
| V1 | All pages | Navigation duplicated: a full top nav and a full sidebar | High |
| V2 | All twins | A permanent explanation card covered the top-left of the model | High (fixed earlier the same day: now a closed "Model info" dropdown) |
| V3 | All twins | Top bar said "SIM RUNNING" while the subtitle says "illustrative, no solver": an animation looked like a solver job | High (trust) |
| V4 | All twins | Three fixed columns: the model got ~45% of the width, and nothing could be collapsed | High |
| V5 | All twins | View toolbar below the fold at 1440×900 | Medium |
| V6 | Dashboard | "Finite-element solver: Not connected in this build" was stale, since backend studies now exist | High (trust: understates, so stale either way) |
| V7 | Dashboard | Unicode glyphs (○ ◉) used as button icons | Low |
| V8 | All | Uppercase 11px panel titles everywhere, 13px base text, mixed radii (5–8px) | Medium |
| V9 | All | Glass/blur used on readable info cards; inconsistent overlay materials | Medium |
| V10 | Design Lab | Two full A/B forms side by side; a difference is hard to spot | Medium (not yet addressed, see §10) |
| V11 | Experiment | Configure, run and evaluate share one long page | Medium (not yet addressed; another work stream owns this page) |

## 4. Functionality that must be protected

- Every route and the old `#/brake-caliper` and `#/spark-plug` links.
- Twin controls: play/pause/reset, time scale, module switch, view presets, cutaway, tyre, explode/build, apply brake (Space), combustion toggle, rig modes.
- Provenance badges (`input`, `derived`, `model`, `estimated`, `theoretical`, `demo`, `drawing`, `assumed`) and their tooltips.
- Design A (amber) vs B (cyan) colour convention (`.slot-a/.slot-b`, `.a/.b`).
- The Design Lab "How far can these numbers be trusted?" warning.
- The backend chip behaviour, the solver panel job states, and the classes and tokens the panel uses.
- The Reports sheet's local token overrides (it redefines `--text`, `--surface`, ... for print).
- `ABChart` props (`markers`, `band`, `labels`, `xFormat`, `zeroBased`, `height`).

## 5. Inconsistencies

Four radius values, three different shadow styles, two blur strengths, button heights from 24 to 36px, and mono used both for numbers and for prose.

## 6. Performance risks

- Four Canvases, each `dpr [1,2]`. Fine for one at a time (only one route is mounted).
- `backdrop-filter` over WebGL costs a re-blur per frame. Kept to small floating controls; no full-screen blur over a canvas.
- Inspector collapse keeps panels mounted (`hidden`) so their state persists; they don't re-render the scene.

## 7. Target architecture

- **One token layer** (`src/theme/theme.css`) defining canonical studio tokens, with the legacy names aliased to them. Nothing gets renamed, so other work streams keep working.
- **Shell:** grouped, collapsible rail; contextual top bar; command palette.
- **Twin layout primitive** (`TwinWorkspace`): collapsible inspectors around the stage.
- Page-specific redesigns live in the page's own files, coordinated with whoever owns them.

## 8. Must not be invented

No fake 3D preview in the Design Lab, no "solver verified" labels, no exploded views or part associations a model doesn't have, no fabricated activity, no Compare page. Twin playback is labelled as playback, never as a solver run.

## 9. Implementation order

1. Token and material layer. 2. Shell (single nav, rail, top bar, palette). 3. Twin workspace (inspectors, stage sizing, status semantics). 4. Dashboard truth fixes. 5. Design Lab A/B difference view. 6. Experiment lifecycle stepper (needs that page's owner). 7. Analytics, AI Insights and Reports polish (owners). 8. QA.
Steps 1–4 are done. See `REDESIGN_CHANGELOG.md`.
