# AutoTwin - Live Build Tracker

**Target:** 24-hour hackathon
**Source of truth:** `AutoTwin_Generative_Engineering_Build_Spec.md`
**Last updated:** 2 November 2026

Status values: `NOT STARTED` / `IN PROGRESS` / `BLOCKED` / `DONE`
Only mark a task `DONE` when its acceptance criteria pass and evidence is recorded.

---

## Headline deviation from the specification (read this first)

The specification nominates **CalculiX** for structural analysis and **Elmer**
for thermal. Preflight found **neither installed**, along with no FreeCAD, no
WSL and no conda. There is no CalculiX binary available on this machine to
point `CALCULIX_BIN` at.

**Decision:** the physics runs on **scikit-fem**, assembled and solved
in-process. This is a real finite-element library - it builds genuine stiffness
and conduction matrices with proper shape functions and solves real linear
systems. It is **not** the "clearly labelled reduced-order fallback" the spec
allows for when a solver is missing, and the spark-plug profile therefore does
**not** need that fallback: it runs full 3D steady-state conduction FEA on a
three-material assembly.

Both solver paths are verified against closed-form solutions before the product
displays any automotive number (evidence under M3 below). The
`SolverAdapter` interface is unchanged, so a CalculiX adapter can be registered
alongside these without touching any caller; `/api/capabilities` reports
truthfully that CalculiX and Elmer are absent.

---

## Overall milestones

- [x] M0 - Environment preflight complete.
- [x] M1 - Backend/frontend foundation complete.
- [x] M2 - Component profiles and CAD generation complete.
- [x] M3 - Meshing and solver benchmark complete.
- [x] M4 - Candidate generation and optimization complete.
- [x] M5 - Dynamic 3D simulation and geometry animations complete.
- [x] M6 - AI requirement parsing and result explanation complete.
- [x] M7 - Cost estimator and report complete.
- [x] M8 - Full end-to-end validation complete.
- [ ] M9 - Demo rehearsal and feature freeze complete.
- [x] M10 - UI rebuilt to the reference product's structure, with the animated engine.
- [x] M11 - Assurance plane: evidence-derived maturity, deterministic pre/post-solver
      gates, validation ladders, seeded failure suite, prohibited-claim enforcement.

## Component readiness

| Component | CAD generation | Mesh | Physics run | Candidate loop | Animation | Export | Status |
|---|---|---|---|---|---|---|---|
| Alloy wheel | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| Brake caliper | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| Spark plug | DONE | DONE | DONE | DONE | DONE | DONE | DONE |

All three run the same pipeline through the same interfaces, with
component-specific geometry, named regions, load cases, objectives and
constraints. The wheel and caliper are linear static structural; the spark plug
is steady-state thermal on three material subdomains.

## Phase log

| Phase | Status | Evidence / notes |
|---|---|---|
| 0 - Environment and engineering preflight | DONE | See M0 below. CalculiX/Elmer absent; scikit-fem selected and benchmarked. |
| 1 - Project foundation and contracts | DONE | 10 SQLite entities, typed Pydantic contracts, 31 API endpoints. |
| 2 - CAD and geometry generation | DONE | Three CadQuery templates, validated solids, STEP + GLB export. |
| 3 - Meshing and physics adapters | DONE | Gmsh + two benchmarked solvers. Conformal multi-material meshing. |
| 4 - Generative candidate loop and optimization | DONE | Seeded LHS DOE and NSGA-II, both run real evaluations. |
| 5 - 3D visualization and dynamic animation | DONE | React Three Fiber viewport on solver field data. |
| 6 - AI assistant, explanation and cost model | DONE | Offline parser + explainer; optional LLM; cost scenario calculator. |
| 7 - End-to-end integration and validation | DONE | 141 tests pass; full HTTP workflow verified. |
| 8 - Demo preparation and freeze | IN PROGRESS | Scenarios work end-to-end; rehearsal outstanding. |
| 9 - Reference-UI rebuild | DONE | Nine-page workspace, A/B design model, live reduced-order estimators. |
| 11 - Guided UX redesign | DONE | Six-section rail, five-step wizard, grouped parameters (geometry / material / conditions), provenance on every value, 65-70% viewport, CAD-import workflow, user-selectable objectives. |
| 10 - Animations for all three components | DONE | Engine cutaway (plug), rolling road load (wheel), brake application (caliper). All parametric from the live design vector, three camera views each. 37 frontend kinematics tests pass. |

---

## M0 - Environment preflight evidence

Commands run on Windows 11, 2 November 2026.

| Item | Found | Note |
|---|---|---|
| Python | 3.10.0 (`C:\Program Files\Python310`) | Spec asked for 3.12; not installed. 3.10 chosen over the 3.13/3.11 present because CadQuery's OCP wheels cover cp310. |
| Node / npm | v24.16.0 / 11.13.0 | |
| Git | 2.54.0 | |
| CadQuery | 2.7.0 | STEP export verified: hollow cylinder, volume 7.5398e-5 m3 against analytic 7.5398e-5. |
| Gmsh | 4.15.2 (OCC kernel) | 3D tet meshing and STEP import verified. |
| scikit-fem | 12.0.2 | Selected solver library. |
| pymoo | 0.6.2 | NSGA-II. |
| pyamg | 5.4.1 | Added during Phase 3 for solver performance (see below). |
| **CalculiX** | **NOT FOUND** | No binary, no FreeCAD bundle. |
| **Elmer** | **NOT FOUND** | |
| **FreeCAD** | **NOT INSTALLED** | |
| **WSL / conda** | **NOT AVAILABLE** | No fallback Linux environment. |

Verification command:

```powershell
python -c "import fastapi, numpy, scipy, trimesh, cadquery, gmsh, pymoo, skfem, meshio, sqlalchemy, pydantic; print('core imports OK')"
```

---

## M3 - Solver verification evidence

Both benchmarks run the **production solver code paths**, not a parallel
implementation, and are re-run by `/api/capabilities` so the UI can display
verification status. `pytest app/tests/test_benchmarks.py`

### Structural: end-loaded cantilever, 200 x 20 x 20 mm, steel, 1000 N tip load

| Quantity | Computed | Reference | Relative error | Tolerance |
|---|---|---|---|---|
| Tip deflection | 9.52245e-4 m | 9.59810e-4 m (Timoshenko) | 7.88e-3 | 5e-2 |
| Tip deflection | 9.52245e-4 m | 9.52381e-4 m (Euler-Bernoulli) | 1.43e-4 | 5e-2 |
| Peak bending stress | 147.65 MPa | 150.00 MPa (M c / I) | 1.57e-2 | 1e-1 |

### Thermal: 1D steady conduction, 100 x 20 x 20 mm bar, k = 45 W/(m.K), 800 K to 400 K

| Quantity | Computed | Reference | Relative error |
|---|---|---|---|
| Max nodal temperature error | 4.77e-12 K | 0 (exact linear profile) | - |
| Heat flow through cold face | 72.0000 W | 72.0 W (k A dT / L) | 1.84e-14 |
| Temperature gradient | 4000 K/m | 4000 K/m | 0 |

### Supporting checks

- **Mesh refinement:** refining 8 mm to 4 mm reduces deflection error; asserted in `test_refinement_reduces_error`.
- **Iterative vs direct:** AMG-preconditioned CG reproduces the direct factorisation to < 1e-6 relative (`test_amg_and_direct_solvers_agree`). On the wheel model the two agreed to 2.2e-11 on peak displacement.
- **Mesh vs CAD volume:** cross-checked on every candidate; wheel mesh matched the CAD solid to 0.038%.

---

## M4-M8 - Working evidence

### Generative loop, alloy wheel (DOE, 8 candidates, exploration mesh)

Real run: 8 generated, 8 solved, 6 feasible, 2 infeasible. The two infeasible
candidates were the two lightest (5.74 kg at 220.7 MPa, FoS 0.93; and 6.73 kg at
137.1 MPa) - both genuinely violated the 120 MPa stress limit. Nothing was
dropped or rescored.

### NSGA-II, alloy wheel (population 6, 4 generations, screening mesh)

25 generated, 18 solved, 17 feasible, **7 failed at geometry validation** with
recorded reasons (spoke dish overhang, spokes merging into a disc, tip wider than
root). Found a feasible 7.650 kg design against the 7.733 kg baseline (-1.1%).

### Mesh convergence caught a real limitation

Re-solving the NSGA-II winner from the 16.2 mm screening mesh on the 6.9 mm
verification mesh moved **peak stress by +50.9%** while displacement moved only
2.1%. The platform reports this as NOT mesh-converged rather than hiding it, and
now also compares the **feasibility verdict** across the two meshes.

### Spark plug, full thermal workflow over HTTP

5 generated, 5 solved, 3 feasible in 46 s. Two genuine rejections: one at
0.9469 mm wall against the 1.0 mm minimum, one at 377.9 C below the 450 C
self-cleaning floor. Three material subdomains meshed conformally
(electrode 770 / insulator 5810 / shell 11769 elements, 266 shared interface
nodes, zero duplicate coordinates).

### Load verification (brake caliper, self-equilibrating clamping case)

| Region | Type | Intended | Assembled | Error |
|---|---|---|---|---|
| piston_bore_surfaces | pressure | 18004.1 N | 18004.1 N | 0.0000% |
| outboard_pad_abutment | force | 18095.6 N | 18095.6 N | 0.0000% |

Each load is integrated back to a resultant **independently** - a pressure load
against the surface-normal integral computed from the facet geometry, a force
load against its requested resultant.

### Test suite

`pytest` - **141 passed** (~100 s without the slow pipeline class; ~7 min with it).
Covers units, schemas, region selectors, all three geometry templates, constraint
evaluation, ranking, the HTTP API, and full-pipeline integration.

### Frontend

`npm run build` - clean. React 19.3.1 + React Three Fiber 9.8.2 + drei 10.7.6
(Fiber v9 for React 19, as the spec requires - v8 was installed first and
corrected).

---

## M11 - Assurance plane evidence

Built from the three research documents supplied on 3 November 2026 (the v1.1
integration addendum, the global industry research dossier v2.3, and the
architectural synthesis). All three converge on the same P0 set, and all three
give the same six maturity levels and the same gate list, so the implementation
follows them directly.

### What drove the design

The decisive finding is FEABench's: language agents asked to set up real
finite-element problems produced runnable solver input 88% of the time and a
correct physics setup 0% of the time. "It ran" and "it is right" are therefore
different facts, and the component that judges a setup has to be independent of
the component that proposed it. Everything below follows from that.

### The maturity ladder

Six evidence-derived levels in `app/engineering/assurance/maturity.py`:

| Level | Name | Requires |
|---|---|---|
| L0 | Virtual prototype | A valid solid inside its design envelope. No solver has run. |
| L1 | Simulation-evaluated candidate | A solver completed, its fields parsed, constraints evaluated against computed metrics. |
| L2 | Numerically verified model | Every assurance check passed, the analytical benchmark matched, balances closed, decision metric mesh-converged. |
| L3 | Experimentally validated model | Comparison against independent physical measurement with stated uncertainty. |
| L4 | Calibrated component twin | Bound to a uniquely identified physical part, parameters updated from its measurements. |
| L5 | Operational predictive twin | Live operational data link with drift monitoring. |

`derive_maturity()` is the only function permitted to assign a level, and it
climbs **only on positive evidence**. Its three-state `Optional[bool]` arguments
distinguish passed, failed and not-recorded; the last two both block. This is
the single rule the whole plane rests on: a level is never reached by an absence
of contradiction.

**This installation reaches L2 at best, and only for a candidate whose
refinement study passed.** L3 and above need physical measurement, which this
installation has none of. `ValidationRecord` therefore defaults to
`not_available`, and no code path moves it to `passed` without a dataset.

### The gates

`app/engineering/assurance/gates.py`. Seventeen checks across two stages, every
verdict a measurement against a threshold written down in that module.

Pre-solver (can stop a candidate before a solve is spent): unit consistency,
dimensional plausibility, material completeness, geometry integrity, interface
invariance, semantic region mapping, force-path declaration, thermal boundary
consistency, mesh quality, mesh volume fidelity.

Post-solver (decides whether a result may be called verified): result field
integrity, decision metric present, load balance, boundary condition coverage,
energy balance, linear solve residual, analytical benchmark, mesh convergence.

`CheckStatus` has five states, not two. `not_run` and `warning` are not passes
and cannot be read as one; `not_applicable` is the only non-pass that does not
block, because a structural run genuinely has no thermal boundary to get wrong.
`blocking_failures` (measured and wrong) is kept separate from `blocking_gaps`
(no evidence either way), because a gap must stop a verification claim without
discarding a candidate that solved correctly.

New engineering work this required: both solvers now compute a real energy
balance (`BalanceCheck`) - external work against strain energy for the
structural path, applied power against sink outflow for the thermal path - and
every catalog material now declares its temper or heat-treatment condition,
because a grade name alone does not determine strength.

### Evidence and provenance

`EvidenceRecord` carries nine hashes and three version strings. A changed
geometry, material, load case, mesh setting, solver or generator changes the
fingerprint, so `is_stale_against()` reports staleness without anyone having to
remember to mark it. `ProvenanceEntry` records every engineering input with its
source type, revision, confirmation state and uncertainty, so a demonstration
fixture can never be mistaken for a supplier's certified figure.

Exports now carry `<run_id>_evidence_manifest.json` alongside the STEP file: a
flat, machine-readable statement of the requirement revision, the input hashes,
every check, the maturity level and the claims the result does not support.

### Validation ladders

W0-W4 (wheel), C0-C4 (caliper), S0-S4 (plug) in `ladders.py`, with the attained
rung marked and every higher rung stating what it would require. This build
reaches **W1, C1 and S1**. The fidelity ladder F0-F4 is also declared; F3 (a
qualified reduced-order model) and F4 (physical test) are marked unavailable,
which is the precondition for nobody relying on one.

### Prohibited claims

`claims.py` holds ten claim patterns with reasons, and `scan_text()` runs over
generated prose **after** the model that wrote it has finished. The result
explainer calls it at every exit via `guard_claims()`, so a template bug
surfaces in the test suite rather than in front of an engineer. A claim becomes
available once its evidence exists: "experimentally validated" is legitimate at
L3, so the guard takes the derived level into account.

### Seeded failure suite F01-F14

`app/tests/test_assurance.py`, run against the real gates on real geometry.
Nothing is mocked into passing or failing.

| ID | Seeded defect | Caught by |
|---|---|---|
| F01 | Unlabelled or unknown unit | `Quantity` construction |
| F02 | Millimetres read as metres | `dimensional_plausibility` |
| F03 | Grade without the property the analysis needs | `material_completeness` |
| F04 | Load on a region the geometry does not have | `semantic_region_mapping` |
| F05 | Caliper pressure used as a pad force | `force_path_declaration` |
| F06 | Load case reused across analysis types | `LoadCase` contract |
| F07 | Hot and cold boundaries swapped | `thermal_boundary_consistency` |
| F08 | Solver exits zero, field contains NaN | `result_field_integrity` |
| F09 | Calibration data reused as validation | `ValidationStatus.calibration_only` |
| F10 | Inputs change after the simulation | `EvidenceRecord.is_stale_against` |
| F11 | Surrogate relied on outside its domain | F3 marked unavailable |
| F12 | Hostile upload filename | generated internal IDs; no `shell=True` |
| F13 | A warning or gap read as a pass | `CheckStatus` semantics |
| F14 | Prohibited claim in generated prose | `scan_text` |

Plus four paired tests that guard the other direction, because a gate that
produces false rejections gets switched off and then protects nothing:
F05b (the caliper force path *passes* on a correct case and shows its
conversion), F08c (the thermal balance closes and stays closed under
refinement), F14b and F14e (legitimate engineering prose, including a computed
percentage change in mass, passes clean).

**False-acceptance rate: 0.0% (0 of 14.)** The suite reports it as a number so a
regression shows up as a rate rather than as one failing test among many.

Two of the three gate defects in the bug table above were found by those paired
positive tests rather than by the seeded ones, and the two energy-balance
defects were found by a live end-to-end run through the API. Seeded failures
prove the gates catch what they are aimed at; they do not prove the gates are
aimed correctly.

### What is shown in the UI

Every headline result carries its maturity badge. The Results page adds the full
maturity panel, the check table with each measurement, and the evidence record
with input provenance. The comparison table has an Evidence column, so two
candidates can never appear to carry equal weight of evidence. The dashboard
shows the six-level ladder with the reachable levels lit and the rest saying
what they would need. Export states the maturity of the design being downloaded,
above the download buttons.

## Bugs found and fixed during the build

These were caught by the validation gates and tests, and are recorded because
each one would otherwise have produced plausible-looking wrong output.

| Found by | Bug | Fix |
|---|---|---|
| Geometry validation gate | Centre-bore measurement sampled the hub OD instead of the bore (reported 160 mm for a 66.6 mm bore). | Measure the minimum material radius on the mounting-face plane, where the bore edge is actually tessellated. |
| Load verification check | Caliper check compared the **net** resultant against one load's magnitude; the clamping case is deliberately self-equilibrating, so a correct model read as a 99.5% error. | Verify each load independently, with an independent geometric reference for pressure loads. |
| Spark-plug pipeline | Volume, bounding box and tessellation used only the first solid, so a 3-body assembly was measured as its electrode alone. | `iter_solids` everywhere; generators declare `expected_solid_count`. |
| Caliper constraint result | A 7.000 mm wall read as violating a 7.000 mm minimum (0.02 - 0.65x0.02 = 0.006999999999999999). | Relative numerical tolerance of 1e-9 in constraint comparison. |
| Assistant parser test | "deflection under 0.9 mm. Our casting cannot go thinner than 7 mm" assigned the two values to the **wrong fields**. | Score context words within the enclosing sentence only, weighted by distance. |
| API smoke test | `gmsh.initialize()` installs signal handlers and fails on any non-main thread - this would have broken **all** meshing through the API and the job manager. | `interruptible=False`, initialise once, clear between uses. |
| Pipeline integration test | `EvaluationCache` defines `__len__`, so an **empty cache is falsy** - `if cache` skipped both the store and the lookup, so the cache never populated. | Compare `cache is not None`. |
| Recommendation prose | Statement quoted bare numbers with no unit ("728.8 to 809.6" were kelvin). | Convert to display units in the prose; asserted by test. |
| Assurance verdict | A check that had not run made the verification status `failed` rather than `unverified`, so a correctly solved candidate was reported as having a defect. | Split `blocking_failures` (measured and wrong) from `blocking_gaps` (no evidence); only the former is a failure. |
| Caliper force-path check | The gate looked for a `pistonBoreDiameter` parameter that does not exist, so the check failed on a *correct* caliper case - a false rejection found by its own paired positive test. | Read `piston_bore_diameter_m`, the real parameter name. |
| Interface invariance check | Reported `threshold=1e-6 m`, implying the interface had been proven to 0.001 mm when the tolerance actually applied was 1 mm. | Report the tolerance actually applied, and state the tessellation limit in the detail text. |
| Thermal boundary check | A swapped hot/cold pair has exactly the same temperature span as a correct one, so a gradient-magnitude test could not see F07 at all. | Read the named regions' thermal roles and check the direction of heat flow against them. |
| Thermal energy balance (1) | The balance only ran when an explicit heat flux or total power was applied. The spark plug is driven entirely by convection, so the check never ran and **every** plug result was permanently blocked from numerical verification by missing evidence. Found by a live end-to-end run, not by a unit test. | Integrate every boundary's actual power from the solved field: convective surfaces by `integral h (T_inf - T) dA`, flux surfaces by their applied power. |
| Reported spark-plug heat flow | `heat_flow_w` was integrated from the recovered temperature gradient at the sink surfaces and was **wrong**: 21.5 W / 34.0 W / 38.2 W on 1.6k / 4.1k / 14.1k-node meshes against a true value near 94 W - under-reporting by 59% at the finest mesh and still moving 12%. It was also the metric failing the mesh-convergence check, so a measurement artifact was being reported as a physical limitation of the design. Hidden because the reduced-order estimator's 37 W agreed with it. | Take the total power leaving the solid from the reaction-based boundary accounting. Converges: 92.8 / 93.4 / 93.8 W (+0.61%, +0.39%). |
| Thermal energy balance (2) | Computing the fixed-temperature boundary's power by integrating the recovered temperature gradient gave an imbalance that **grew** with refinement (2.99% at 1.6k nodes, 11.4% at 4.1k, 23.8% at 14.1k) - the signature of a quantity that does not converge. | Take the reaction from the residual `K T - f` at the constrained DOFs, the thermal analogue of a reaction force. Closes to 0.00000% at every fidelity. Sign settled against the physics (the 150 C seat under 900 C gas must remove heat), not assumed. |

---

## Known issues and limitations

| Item | Detail |
|---|---|
| Peak stress is not mesh-converged at screening fidelity | Moves ~50% between 16 mm and 7 mm meshes on the wheel. Displacement and mass are converged (<1%). Use screening to rank candidates, verification for absolute values. The platform reports this per run. |
| Solve time | ~45 s per wheel candidate at exploration fidelity (~140k DOF); ~6 s per spark-plug candidate. A 7-candidate wheel DOE takes ~6 min. This is real compute, not a progress animation. |
| Material data is illustrative | The shipped catalog is handbook-class, tagged `illustrative_handbook_value`. Must be replaced with supplier-certified data before any engineering decision. |
| Imported STEP is not parametric | Arbitrary uploads can be viewed, meshed and analysed, but cannot be regenerated by the search. Stated in the API response and the UI. |
| Wheel barrel is conservative | Constant-wall barrel with no bead flanges or drop centre, so computed deflection is higher than a real wheel of the same mass. Recorded as an assumption. |
| Single load case per profile | The wheel runs one radial case; the caliper runs clamping only (no brake torque); the spark plug runs one steady operating point. |
| Gmsh is serialized | One global lock, so candidates mesh one at a time even with multiple worker threads. |
| Interface invariance is proven to 1 mm, not 0.001 mm | The research documents call for a +/-0.001 mm interface tolerance. Preserved interfaces are measured on the tessellated solid, which cannot resolve a micrometre, so the generators declare a 1 mm measurement tolerance. Measured deviations are in fact 0.00000 mm (geometry is built straight from the parameter vector), but the gate only proves 1 mm and says so in its own detail text rather than reporting the target as achieved. Closing the gap needs the interface measured against the analytic CAD feature instead of its triangulation. |
| L3 and above are unreachable here | No physical measurement exists in this installation, so `ValidationRecord` is permanently `not_available` and the maturity ceiling is L2. This is a property of the data available, not a missing feature. |
| Mesh convergence is a study-level fact | An individual candidate records `mesh_convergence: not_run`, because the check needs two solves at different fidelities. Only the recommended candidate is re-assessed after the refinement study, so only it can reach L2. |
| The energy balance is a consistency check, not an accuracy one | Both forms are identities of the assembled system, so a correct model closes them to the solver residual at any mesh density. The check catches a boundary that applied nothing, a flux sign error, a missing Robin term and an unsolved system. It does **not** show the mesh is fine enough - a coarse mesh conserves energy exactly while still getting the temperature wrong. Mesh convergence is the separate check for that, and the two are deliberately not merged. |
| Spark-plug peak temperature gradient does not converge | After the heat-flow fix, `max_temperature_gradient_k_per_m` is the one metric still moving: 82k / 96k / 118k K/m across the three mesh densities. This is a real singularity at a material interface, where the peak gradient grows without bound as the mesh is refined, so it is not a defect to be fixed. It is reported honestly. |
| Mesh convergence can be `inconclusive`, and for the spark plug it is | The research evidence schema records convergence in four states - `not_run | passed | failed | inconclusive` - and judges it on "the trend in the decision quantity ... include region-specific metrics". An earlier build collapsed this to a boolean over **all** metrics, so the singular peak gradient made the study read as `failed` and permanently blocked L2. That was a false negative, the mirror of the false acceptance this work exists to prevent: refining further can never converge a singular quantity. The gate is now split - a **blocking** check on the decision quantity, an **advisory** check naming every region metric that kept moving - and the study is recorded `inconclusive` when the decision quantity converged but a region metric did not. Measured live at 1,695 -> 22,600 nodes: mass +0.77%, peak temperature **-0.73%**, minimum temperature -0.02%, heat flow **+1.30%**, peak temperature gradient **+32.38%**. The plug reaches L2 on the decision quantity and carries the inconclusive study as a standing limitation on every report. |

## Current blocker log

| Date/time | Module | Error / blocker | Action / fallback | Status |
|---|---|---|---|---|
| 2 Nov 2026 | solvers | CalculiX and Elmer absent; no WSL or conda to install them | Adopted scikit-fem in-process, verified against closed-form benchmarks; adapter interface preserved for CalculiX | RESOLVED |
| 2 Nov 2026 | solvers | 226 s per wheel solve made a candidate loop undemonstrable | AMG-preconditioned CG (pyamg) with rigid-body near-nullspace; 5.4x faster, verified against the direct solve | RESOLVED |
| 2 Nov 2026 | meshing | Multi-solid STEP meshed non-conformally, leaving the spark-plug assembly thermally disconnected | `occ.fragment` before meshing; verified 266 shared interface nodes and zero duplicate coordinates | RESOLVED |

---

## Demo readiness checklist

- [x] Primary workflow can be repeated from a clean app start.
- [x] At least one complete generated-design -> physics -> re-evaluation loop is working.
- [x] All values shown in the UI match stored solver/model outputs.
- [x] Every demo assumption is labelled.
- [x] Failed jobs show a useful error instead of a fake success.
- [x] Selected design exports to STEP and reopens in a CAD viewer.
- [x] Candidate comparison and report are consistent.
- [x] Backup demo assets are labelled as stored/precomputed if not generated live. No precomputed assets ship with the app - every artifact under `storage/` is real solver output from a run on this machine - but a stored result on screen was previously indistinguishable from a live one. `StudyResultOut` now carries `started_at`/`completed_at`, and Results and Export show a **stored result** or **computed live** stamp with the timestamp, decided by comparing the completion time with the browser session start.
- [ ] Rehearse one complete primary workflow end to end against the clock.
