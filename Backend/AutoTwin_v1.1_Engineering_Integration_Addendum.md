# AUTOTWIN v1.1 — Engineering Integration Addendum

**Purpose:** Add the missing research-backed engineering controls, validation requirements and long-term capabilities to the existing *AutoTwin / Generative Engineering Build Specification v1.0*.

**Document type:** Additive implementation patch. This document is designed to be merged into the existing 32-page build specification. It is not a replacement for the original document.

**Prepared:** 3 November 2026  
**Baseline:** AutoTwin Generative Engineering Build Specification v1.0 (2 November 2026) and AutoTwin Research-Grade Review and Engineering Strategy (2 November 2026).  
**Implementation principle:** Preserve the original 24-hour MVP. Add only the minimum assurance work required to make its outputs honest and reproducible. Put advanced physics, physical calibration, uncertainty-aware optimisation, reduced-order models and enterprise interoperability into explicitly gated post-hackathon phases.

---

## 0. Change-control rules

### 0.1 What this addendum changes

This addendum strengthens the existing specification in six areas:

1. Engineering evidence and provenance from requirement through CAD, simulation, test and approval.
2. Separate code verification, solution verification, physical validation and uncertainty quantification (V&V/UQ).
3. Component-specific validation pathways for alloy wheels, brake calipers and spark plugs.
4. Failure-oriented evaluation of AI-generated engineering setups.
5. Test-aware model calibration, robust design exploration and qualified reduced-order models.
6. A staged digital thread and interoperability path using relevant standards without making enterprise integration an MVP dependency.

### 0.2 What this addendum does not change

The following core v1.0 decisions remain in force:

- AutoTwin's 24-hour deliverable is a locally runnable virtual product-development platform, not a production-certified CAE suite.
- Keep the three component profiles: alloy wheel, brake caliper and spark plug.
- Keep a shared orchestration platform but separate component physics, inputs, material properties, load cases and solver profiles.
- Use deterministic parametric CAD generation; do not use an LLM as the CAD kernel, mesh generator, physics solver or authority for engineering acceptance.
- Keep the original stack unless a tested technical blocker requires a change: React/TypeScript, FastAPI/Pydantic, CadQuery/OpenCASCADE, Gmsh, CalculiX, verified Elmer path or labelled reduced thermal model, SciPy/pymoo, SQLite and local artifact storage.
- Do not make full topology optimisation, fatigue, contact/nonlinear analysis, combustion CFD, physical calibration, machine-learning surrogates, AAS or Catena-X mandatory for the 24-hour build.
- Never create fake solver outputs, fake field data, unsupported safety factors or untraceable engineering claims.

### 0.3 Priority definitions

| Priority | Meaning | Delivery rule |
|---|---|---|
| **P0 — MVP integrity** | Minimum requirements needed for truthful, reproducible demo outputs | Implement in the existing 24-hour phases where feasible. A small, honest vertical slice is preferable to superficial coverage. |
| **P1 — Engineering foundation** | Needed before using the system for serious engineering studies or comparing candidate designs beyond a demo | Implement after the hackathon, before making validation or design-improvement claims. |
| **P2 — Research/industrial extension** | Advanced physics, physical data connection, robust optimisation, ROM and enterprise interoperability | Implement only after the relevant P0/P1 model and evidence gates pass. |

### 0.4 Evidence and maturity vocabulary — insert into original Section 0.2

Use the following exact status labels in the UI, reports, API and database. Status is derived from stored evidence and deterministic rules; the LLM must never assign or upgrade it.

| Status | Minimum entry conditions | Explicitly does not mean |
|---|---|---|
| **Virtual Prototype** | A generated/imported virtual geometry and its design parameters exist. | A physical counterpart exists or has been measured. |
| **Simulation Evaluated** | Geometry checks pass; the configured analytical model or solver completes; result parsing, units, assumptions and input provenance are stored. | The model is numerically verified, physically validated or certified. |
| **Numerically Verified** | Applicable code/solution verification and numerical-quality gates pass for a stated model, solver version and intended use. | The model predicts the real component accurately. |
| **Experimentally Validated** | Predictions are compared with independent physical measurements for a defined component, configuration, operating domain and set of quantities; errors and measurement uncertainty are reported. | The model is valid outside the tested domain. |
| **Calibrated Component Twin** | A uniquely identified physical component is linked to measured data; selected model parameters/state are updated through a documented calibration method; the updated model is revalidated on independent evidence. | The model is real-time, universally valid or production-approved. |
| **Operational Predictive Twin** | Defined physical-data update cadence, data-quality monitoring, model-drift checks, qualified prediction domain, uncertainty, decision governance and operating fallback exist. | Autonomous physical actuation or product certification unless separately authorised. |

**UI rule:** show the status, intended-use domain, last evidence date and unresolved limitations next to every headline result. For the 24-hour demo, the highest possible status will normally be *Simulation Evaluated* or *Numerically Verified* for the specific benchmarked model. Do not label the demo a calibrated or operational twin unless physical-instance and update evidence exists.

---

# 1. Exact insertion map into the v1.0 document

| Original location | Required edit | Priority | Implementation phase |
|---|---|---:|---|
| Section 0.2, pages 1–2 | Add the maturity vocabulary above and preserve the virtual-prototype distinction. | P0 | Phase 1; show in Phase 5 UI |
| Section 2.3, pages 4–5 | Add wheel load-case limitations and W0–W4 validation ladder. | P0/P1/P2 | Phase 0–3 initially; post-hackathon wheel stages |
| Section 2.4, pages 5–6 | Add explicit caliper load path and C0–C4 validation ladder. | P0/P1/P2 | Phase 0–3 initially; post-hackathon caliper stages |
| Section 2.5, pages 6–7 | Add direct spark-plug evidence and S0–S4 thermal/durability ladder. | P0/P1/P2 | Phase 0–3 initially; post-hackathon plug stages |
| Section 3.3–3.5, pages 8–9 | Add sensitivity and robust optimisation as staged capabilities; retain small deterministic MVP search. | P1/P2 | Phase 4 now; advanced later |
| Section 4.1, page 9 | Correct thermal-conductivity unit notation. | P0 | Phase 0 |
| Section 4.3–4.5, pages 9–11 | Extend material/process provenance, result provenance and invalidation rules. | P0/P1 | Phases 1–3 |
| Section 4.6, page 11 | Expand into code verification, solution verification, physical validation and UQ. | P0/P1 | Phases 0, 3 and 7 |
| **New Section 4.7** | Engineering evidence and provenance contract. | P0 | Phase 1 |
| **New Section 4.8** | Physical test-data ingestion and calibration record. | P1 | Post-hackathon physical-data phase |
| **New Section 4.9** | Uncertainty and sensitivity contract. | P1/P2 | Post-hackathon research phases |
| Section 5, pages 11–15 | Add deterministic assurance service and controlled simulation-case retrieval. | P0/P1 | Phases 1, 3 and 6 |
| Section 7, pages 17–18 | Add AI evaluation, action boundaries and retrieval-grounded setup rules. | P0/P1 | Phase 6 |
| Section 8, pages 18–20 | Add evidence, test, calibration and approval entities; add downstream invalidation. | P0/P1 | Phase 1; extended post-hackathon |
| Section 11, pages 23–26 | Update phase tasks and acceptance gates using Section 3 of this addendum. | P0 | All 24-hour phases |
| Section 13, pages 27–28 | Add seeded-invalid-case tests and false-acceptance metrics. | P0/P1 | Phases 0, 3 and 7 |
| Section 14, page 28 | Add assurance, data-quality and model-drift risks. | P0/P1/P2 | Phase 0 and future roadmap |
| Section 18, page 31 | Replace the broad future roadmap with staged research/industrial phases. | P1/P2 | Post-hackathon |
| Section 19, page 32 | Add current standards applicability register and paper references. | P0/P1 | Phase 0 and future roadmap |
| Section 20, page 32 | Add maturity-based definition of done and claim restrictions. | P0 | Phase 7–8 |

---

# 2. Exact content to insert or amend

## 2.1 Amend Section 2.3 — Component profile A: Alloy Wheel

Keep the existing MVP scope: linear-static structural analysis, at least one declared load case, interface preservation, mass/stress/displacement outputs and no fatigue-certification claim.

**Add the following immediately after the existing “Not in MVP” list in Section 2.3:**

### Advanced wheel validation pathway (post-hackathon)

| Level | Model/test capability | Required evidence before enabling the level |
|---|---|---|
| **W0 — Solver verification** | Analytical beam/plate or simple annular structural benchmark using the selected element family and solver settings. | Comparison against an analytical/trusted reference; mesh-refinement trend; reaction-force balance; recorded solver and mesh versions. |
| **W1 — Component static** | Wheel CAD with explicit hub/mount representation and one declared radial or bending-equivalent load case. | Geometry/interface checks; stress/displacement; reaction balance; mesh-convergence evidence for decision quantities. |
| **W2 — Test-configuration models** | Separate radial-drum and cornering-fatigue configurations. | Fixture and mounting assumptions; tyre inclusion/exclusion rationale; inflation and bead-seat assumptions where relevant; test strain/displacement if available. |
| **W3 — Biaxial tyre–rim interaction** | Coupled tyre/rim or equivalent justified interaction model with simultaneous radial/lateral loading and test-bench kinematics. | Contact/transfer assumptions; camber or overturning-moment response; measured test comparison for the stated configuration. |
| **W4 — Durability prediction** | Measured load histories, cycle counting and a material-appropriate multiaxial fatigue model. | Material fatigue data; load-history provenance; fatigue-model assumptions; predicted damage/life and failure location compared with independent test results. |

**Wheel-specific engineering rules:**

1. A single hub-fixed static model is acceptable only for the explicitly declared simplified MVP case. It must not be described as radial-fatigue, cornering-fatigue or biaxial validation.
2. Radial fatigue, cornering fatigue and biaxial fatigue are separate load-case profiles. Do not reuse one boundary-condition definition for all three.
3. Advanced radial-fatigue modelling may need wheel–tyre assembly, bead-seat/interference assumptions, inflation pressure, tyre deformation and drum contact. Include only the mechanisms required by the selected test and validate them.
4. Cornering-fatigue modelling must document whether tyre mechanics are omitted or included and how the applied bending moment is transferred to the hub/wheel.
5. Record bolt preload, wheel mounting, contact/friction and fixture compliance when those effects are relevant to the selected test.
6. Material records should distinguish alloy grade and temper from manufacturing route, batch, heat treatment, surface condition and relevant residual-stress/defect information. Do not assume a handbook material card captures every production wheel.
7. A fatigue result is not a road-use approval or regulatory certification. It is a prediction within the validated model and test domain.
8. Keep passenger-car/light-truck and heavy-commercial-vehicle (HCV) duty cycles separate. The ARAI/SAE 2024 India-specific HCV load-cycle paper is a candidate HCV research source, not a universal passenger-car duty cycle.

**Research basis:** Ferrari wheel fatigue and failure work compares radial and cornering test configurations and uses different model assumptions; Venturini et al. study steel-wheel fatigue and tyre–rim biaxial interaction; ARAI/SAE 2024 develops an HCV-specific Indian biaxial fatigue cycle. These sources support the staged model ladder, not automatic transfer of their numerical loads to AutoTwin.

References:
- Zanchini et al., *Fatigue and failure analysis of aluminium and composite automotive wheel rims: Experimental and numerical investigation* (2023), DOI: https://doi.org/10.1016/j.engfailanal.2023.107064
- Venturini et al., *An automotive steel wheel digital twin for failure identification under accelerated fatigue tests* (2024), DOI: https://doi.org/10.1016/j.engfailanal.2024.107979
- Venturini et al., *A tyre-rim interaction digital twin for biaxial loading conditions* (2024), DOI: https://doi.org/10.1016/j.mechmachtheory.2023.105491
- Bakal et al., *Development of India Specific Biaxial Test Cycle... for Heavy Commercial Vehicles* (SAE 2024), DOI: https://doi.org/10.4271/2024-26-0322

## 2.2 Amend Section 2.4 — Component profile B: Brake Caliper

Keep the current MVP as a simplified linear-static caliper-body model with declared equivalent loads and constraints. Do not imply that the MVP contains complete brake-system contact physics.

**Add immediately after the current “Not in MVP” list:**

### Advanced brake-caliper validation pathway (post-hackathon)

| Level | Model/test capability | Required evidence before enabling the level |
|---|---|---|
| **C0 — Solver verification** | Analytical bracket/block or other known linear-elastic benchmark. | Reference displacement/stress; mesh refinement; reaction-force balance. |
| **C1 — Caliper-body MVP** | Simplified body with documented mounting supports and piston/pad reaction representation. | Result provenance; stress/displacement; constraint checks; named-region checks; assumptions. |
| **C2 — Assembly load path** | Caliper, piston, pads, disc and carrier represented with appropriate interaction/contact. | Contact definitions; pressure/load transfer; contact convergence; measured strain/displacement where available. |
| **C3 — Rotating/inertial dynamometer** | Test-specific pressure ramps and rotating disc/flywheel conditions. | Pressure, speed, temperature and fixture metadata; strain/displacement and thermocouple correlation; measurement uncertainty. |
| **C4 — Thermomechanical durability** | Thermal cycles, stress history, fatigue/wear models where supported by suitable data. | Temperature-dependent material behaviour, fatigue/wear parameters and independent durability-test comparison. |

**Caliper-specific engineering rules:**

1. Distinguish hydraulic pressure, piston force and pad reaction/clamping force. Do not treat them as interchangeable inputs. Record piston count, effective piston area and the assumptions used in any conversion.
2. Document the complete force path: piston → pad → disc reaction → caliper bridge/body → mounting carrier. The simplified MVP may collapse this path into an equivalent load, but the simplification must be visible.
3. Identify mounting-ear constraints, bolt interfaces, piston-bore interfaces and pad-abutment regions semantically. Do not depend on unstable CAD face indices.
4. For contact models, store contact formulation, friction assumption, initial gap/penetration handling, contact convergence and any stabilisation settings.
5. Physical displacement measurements must identify their reference frame and fixture compliance. If the test removes rigid-body movement by combining gauge readings, preserve that calculation method rather than comparing incompatible absolute displacements.
6. Thermocouple position, adhesive/attachment method, thermal compensation, sensor calibration and test sequence should be included with rotating-disc measurements.
7. A topology-optimised shape is not experimentally validated merely because it was manufactured. The model needs an explicit measured test comparison.

**Research basis:** Vecchiato, Capraro and Meneghetti (2024) provides a particularly useful Scalmalloy caliper workflow from design and topology optimisation through additive manufacturing and dynamometer correlation. Tirovic et al. (2012) provides earlier structural-analysis and strain/displacement comparison evidence. Tyflopoulos et al. (2021) is useful for numerical topology optimisation but should not be cited as physical caliper validation.

References:
- Vecchiato et al. (2024), DOI: https://doi.org/10.3390/vehicles6030075
- Tirovic et al. (2012), DOI: https://doi.org/10.1177/0954407011423447
- Tyflopoulos et al. (2021), DOI: https://doi.org/10.3390/app11041437

## 2.3 Amend Section 2.5 — Component profile C: Spark Plug

Keep the current MVP as steady-state heat conduction using a verified thermal solver or explicitly labelled analytical/reduced-order model. Do not present a steady-state colour ramp as a transient engine-cycle thermal simulation.

**Add immediately after the current “Not in MVP” list:**

### Advanced spark-plug validation pathway (post-hackathon)

| Level | Model/test capability | Required evidence before enabling the level |
|---|---|---|
| **S0 — Analytical network** | One-dimensional multilayer conduction/resistance network. | Hand-checkable temperature drops, heat flow and energy balance. |
| **S1 — 3D steady conduction** | Shell, insulator, centre electrode and ground electrode with defined interfaces and thermal properties. | Material/property provenance, thermal boundary-condition provenance, mesh convergence and energy balance. |
| **S2 — Engine-coupled heat input** | Cycle-dependent or cycle-averaged gas-side heat transfer at a defined operating point. | Gas-side heat-flux model, crank-angle/operating-point assumptions and evidence that cycle averaging is valid for the use case. |
| **S3 — Instrumented physical validation** | Plug/engine test with temperature measurement. | Sensor type, location, calibration, installation influence, acquisition timing, engine speed/load and independent holdout comparison. |
| **S4 — Degradation** | Electrode erosion, oxidation, interface cracking or joining/process effects. | Specialist multiphysics/material model and comparison with microscopy, wear, erosion or process-test evidence. |

**Spark-plug-specific engineering rules:**

1. Separate gas-side heat input, conduction through electrodes/insulator/shell, seat-to-head heat transfer and external cooling/convection assumptions.
2. Use temperature-dependent thermal conductivity and heat capacity where their variation is material to the intended operating domain.
3. Preserve the thermal/electrical/mechanical interfaces in CAD. Electrical clearance checks are not an electrical discharge simulation.
4. A cycle-averaged heat-flux model is permitted only after the cycle-averaging assumption has been justified for the defined engine speed/load and design range.
5. Store sensor location and installation details. A measured temperature is not meaningful without its measurement position, instrument calibration and operating conditions.
6. Treat electrode erosion/plasma and joining-interface degradation as separate specialist models. Do not claim them from steady-state conduction.

**Research basis:** Osaka et al. (2020) couples spark-plug heat conduction to combustion-side heat transfer and compares modelled plug temperature with experiment; its heat-transfer model required tuning. Tahri et al. (2020) investigates copper–Inconel ground-electrode thermo-mechanics and interface/process effects. Tilz et al. (2023) provides in-situ spark-plug temperature measurement context. Breden et al. (2019) is a future erosion-modelling reference.

References:
- Osaka et al. (2020), https://www.jstage.jst.go.jp/article/tse/28/3/28_29/_article
- Tahri et al. (2020), DOI: https://doi.org/10.3390/en13153798
- Tilz et al. (2023), DOI: https://doi.org/10.1016/j.wear.2023.204730
- Breden et al. (2019), DOI: https://doi.org/10.4271/2019-01-0215

## 2.4 Add to Section 3 — Robust design exploration

**Insert new Section 3.6 after existing Section 3.5:**

### 3.6 Sensitivity and robust optimisation (staged capability)

The MVP shall perform deterministic candidate exploration and compare candidates using the same declared analysis profile. Robust optimisation is a post-hackathon capability and must not delay the first end-to-end pipeline.

#### Level 1 — Deterministic baseline comparison (P0)

- Run the baseline and candidates with the same material snapshot, load definition, boundary conditions, solver settings and declared mesh policy.
- Record whether mesh sizes differ and whether this can materially bias the comparison.
- Keep failed candidates in the evaluation record with a failure category.
- Rank only candidates with completed evaluations and passed configured feasibility constraints.

#### Level 2 — Sensitivity analysis (P1)

- Identify important uncertain inputs: material properties, loads, dimensions, contact/friction assumptions and boundary-condition parameters.
- Vary one factor at a time for screening, then use a designed experiment (e.g., Latin hypercube or factorial/response-surface design) where justified.
- Record the range and source of each variation. Do not invent probability distributions.
- Report which inputs dominate stress, displacement, temperature, mass or feasibility.

#### Level 3 — Robust or reliability-based optimisation (P2)

- Use measured or defensibly sourced distributions for uncertain inputs.
- Evaluate candidate feasibility under sampled input variations or a justified reliability/chance constraint.
- Report nominal performance, robust feasibility, worst observed violation and the variation range.
- Compare robust and nominal Pareto fronts; do not claim a robust optimum from a single nominal run.

**Required output fields:** `nominal_objectives`, `variation_definition`, `sensitivity_summary`, `robust_feasible_fraction` (only if sampled), `worst_constraint_violation`, `sample_count`, `random_seed`, `sampling_method`, and `uncertainty_source`.

Do not interpret a sampled feasible fraction as a calibrated probability unless the sampling distributions and model are justified for that purpose.

## 2.5 Correct Section 4.1 — Unit notation

Replace the thermal-conductivity notation:

- **Incorrect:** `W/(m/K)`
- **Correct:** `W/(m·K)` (equivalently `W m⁻¹ K⁻¹`)

Keep absolute temperature in kelvin internally when equations require it. A temperature difference may be represented in kelvin or degrees Celsius as appropriate, but the type/schema must state which quantity is stored.

## 2.6 Amend Section 4.3 — Material and process data

Add these fields to each material or material-condition record where applicable:

- `material_specification` and exact grade/temper/condition;
- `manufacturing_route` (cast, forged, machined, LPBF/additive, formed, joined, etc.);
- `supplier_or_batch_id` if known and authorised for use;
- `heat_treatment` / process state;
- `orientation_or_build_direction` for anisotropic/additive products where relevant;
- `surface_condition` and measured hardness where relevant;
- `temperature_range_of_property_data`;
- `property_test_method`, `specimen_direction`, `test_temperature` and `source_document`;
- `property_uncertainty` or `variation_range` when available;
- `record_revision`, `reviewer` and `review_date`.

A handbook property value may be acceptable for a clearly labelled demonstration model. It must not be represented as measured batch-specific material data. Do not populate missing fatigue, plasticity, creep or temperature-dependent properties with guessed values.

## 2.7 Amend Section 4.5 — Simulation result contract

Retain all current fields and add the following optional/versioned groups:

```json
{
  "evidence": {
    "requirement_revision": "...",
    "geometry_hash": "...",
    "material_snapshot_hash": "...",
    "load_case_hash": "...",
    "mesh_hash": "...",
    "solver_input_hash": "...",
    "solver_version": "...",
    "generator_version": "...",
    "code_commit": "..."
  },
  "verification": {
    "status": "not_run | passed | failed | not_applicable",
    "benchmark_id": "...",
    "mesh_convergence_status": "not_run | passed | failed | inconclusive",
    "reaction_balance_error": null,
    "energy_balance_error": null,
    "checks": []
  },
  "validation": {
    "status": "not_available | not_validated | calibration_only | passed | failed",
    "physical_instance_id": null,
    "dataset_id": null,
    "intended_use_domain": "...",
    "metrics": [],
    "measurement_uncertainty": null
  },
  "uncertainty": {
    "status": "not_assessed | screening_only | quantified",
    "input_ranges_or_distributions": [],
    "sensitivity_results": [],
    "prediction_intervals": null
  },
  "maturity": "virtual_prototype | simulation_evaluated | numerically_verified | experimentally_validated | calibrated_component_twin | operational_predictive_twin"
}
```

Implementation note: this is a conceptual extension. Convert to strict Pydantic models with enums, validation and schema versioning. Null or missing evidence must remain “not available,” never be auto-converted to “passed.”

## 2.8 Add new Section 4.7 — Engineering evidence and provenance

### 4.7.1 Required traceability chain

Every candidate and every engineering report must be traceable through:

`Requirement revision → component/physical-instance identity → CAD revision → material-property snapshot → load case and boundary conditions → mesh and solver configuration → solver run → numerical verification → physical dataset → calibration/validation revision → optimisation decision → engineer approval`.

For the MVP, the physical-instance, test and calibration links may be absent, but their status must be explicitly `not_available` rather than implied.

### 4.7.2 Provenance rules

Every numeric engineering input must carry:

- value and unit;
- source type (`user_supplied`, `measured`, `approved_database`, `literature`, `demo_assumption`, `derived`);
- source identifier/URL/document and page/table where available;
- record revision and date;
- confirmation/approval status;
- uncertainty/range if available.

Derived values must record the formula, parent input identifiers and software/version used to derive them.

### 4.7.3 Versioning and invalidation

A change to geometry, material snapshot, load, support/contact definition, unit conversion, mesh policy, solver version/settings, calibration parameter or relevant code version must create a new immutable run configuration. Invalidate only the dependent downstream results and recompute when required. Do not overwrite the old evidence record.

Candidate-cache keys must include at minimum: geometry hash, parameter set, material snapshot, load/boundary-condition definition, mesh configuration, solver version/settings, relevant tolerances and code/generator version.

### 4.7.4 Evidence package

Each selected candidate export should include a machine-readable JSON manifest and human-readable report containing:

- design and geometry revision;
- parameter values and protected-interface checks;
- material source and assumptions;
- load cases and boundary conditions;
- mesh statistics and solver details;
- result quantities with units and whether nodal/elemental;
- verification/validation status;
- known limitations and warnings;
- maturity label and approval state.

## 2.9 Add new Section 4.8 — Physical test-data ingestion and calibration (P1/P2)

This section defines a future capability; it is not a requirement to acquire sensors or test equipment during the 24-hour build.

A physical dataset must include:

- `physical_instance_id`, component serial/lot identifier where permitted, design revision and test article configuration;
- test rig/fixture identity, mounting, boundary conditions and procedure revision;
- measured channel name, quantity, unit, coordinate/reference frame and sensor location;
- sensor/instrument type, range, accuracy, calibration certificate/date and installation method;
- sample rate, timestamp/time synchronisation, filtering and preprocessing;
- environment and operating condition (temperature, speed, pressure, load, cycle, etc.);
- repeat number, operator/lab, test date and data-quality flags;
- measurement uncertainty and missing/outlier handling;
- raw-data checksum and processed-data transformation history.

Calibration and validation must be separate:

1. Declare the model intended use and the output quantities to be calibrated.
2. Select a limited set of parameters with a physical rationale (e.g., effective stiffness, contact conductance or selected material parameter).
3. Check sensitivity and parameter identifiability before tuning several parameters simultaneously.
4. Use calibration data for parameter estimation only.
5. Use independent tests, held-out load cases or repeated articles for validation.
6. Report residuals, measurement uncertainty, model discrepancy and parameter uncertainty.
7. Record the calibrated model revision and re-run the applicable numerical verification checks.

Do not “update the twin” by directly overwriting material properties or model parameters from a CSV without recording the estimation method and evidence.

## 2.10 Add new Section 4.9 — Uncertainty and model discrepancy (P1/P2)

Distinguish at least:

- **Input uncertainty:** loads, dimensions, material properties, boundary conditions, sensor measurement and environmental conditions.
- **Parameter uncertainty:** uncertainty in calibrated values such as stiffness, conductivity or contact parameters.
- **Numerical uncertainty:** mesh/time-step/solver tolerance effects.
- **Model-form discrepancy:** missing or simplified physics, such as omitted tyre contact, caliper contact or cycle-resolved gas-side heat transfer.

Do not combine these into one unexplained confidence score. Document each source and how it enters a prediction.

Minimum research workflow:

1. Identify uncertain inputs and their evidence source.
2. Perform sensitivity screening.
3. Assess identifiability before calibration.
4. Propagate uncertainty using a method suited to the model and compute budget (e.g., deterministic bounds, Monte Carlo, Latin-hypercube sampling or Bayesian inference when justified).
5. Report prediction intervals or output ranges and explain what is excluded.
6. Reassess candidate feasibility under the declared uncertainty.

No probability distribution may be invented solely to create a probabilistic result. If only a plausible engineering range is known, report a range/sensitivity study rather than a probability.

---

# 3. Architecture and AI-agent additions

## 3.1 Add to Section 5 — Deterministic Engineering Assurance Service (P0)

Add a distinct service between solver-input generation and solver execution, and again between solver parsing and candidate acceptance.

### Pre-solver checks

- Input schema and schema-version validation.
- Unit dimensionality and conversion checks.
- Required material fields and property-temperature-range checks.
- Parameter bounds and protected-interface invariants.
- Semantic physical-region existence and entity-count checks.
- Load/support/thermal-boundary region compatibility.
- Mesh element type and mesh-quality threshold checks.
- Solver-profile capability check (reject unsupported analysis types).
- Required assumptions and user/engineer confirmation check.

### Post-solver checks

- Solver exit code and expected result-file presence.
- Parser completeness and finite-value checks.
- Result units and nodal/elemental location checks.
- Global reaction-force balance for applicable static structural cases.
- Energy/heat-flow balance for applicable thermal cases.
- Displacement sign/direction and expected physical response checks where an independent expectation exists.
- Benchmark/mesh-convergence status.
- Constraint evaluation using explicit configured limits.

A check can return `passed`, `failed`, `warning`, `not_run` or `not_applicable`. Do not convert a warning or missing check into a pass.

### Acceptance rule

A candidate can be marked `Simulation Evaluated` only if the configured evaluation method completed and its outputs passed structural result-contract checks. It can be marked `Numerically Verified` only when the relevant verification profile passed. Experimental validation requires independent physical evidence. A solver exit code alone is insufficient.

## 3.2 Add to Section 5 — Curated Engineering Case Library (P1)

Create a versioned library of approved starting cases. Each record should be indexed by:

- component profile and analysis type;
- geometry family and element family;
- material class and property-temperature range;
- load/boundary-condition class;
- contact/thermal formulation;
- solver and version;
- intended-use domain;
- benchmark/validation status;
- limitations and source reference.

Retrieval may suggest a case to the engineering planner, but a retrieved case is not automatically correct for the new geometry. The system must re-check the new request's region mapping, material, units, load path and solver capability.

The initial library should contain only the team's tested benchmark cases and clearly labelled literature-derived templates. Do not ingest arbitrary internet solver decks as approved truth.

## 3.3 Amend Section 7 — AI responsibility and evaluation

Keep the LLM as requirement interpreter, missing-input detector, retrieval assistant and result explainer. Add these rules:

1. The LLM can propose a structured setup; only typed schemas and deterministic validators can accept it for execution.
2. The LLM must cite the stored input/result/evidence IDs when explaining an engineering conclusion.
3. The LLM cannot independently certify physics correctness, validation status, roadworthiness, manufacturing readiness or maturity level.
4. A correction loop must retain the original failed proposal, diagnostic, corrected configuration and final result.
5. A human must confirm assumptions with material, load, support, contact, thermal or safety significance.
6. External actions (exporting an approved design, changing a physical machine, releasing a production revision) must be separately authorised and audited. The hackathon MVP does not control physical machinery.
7. Retrieval examples are reference templates, not permission to reuse values or boundary conditions from a different part/test.

### AI reliability scorecard

Report separate rates, not one blended “AI accuracy” score:

- requirement-schema validity;
- correct missing-input detection;
- CAD code execution rate;
- valid-solid rate;
- protected-interface pass rate;
- correct material/load/support/thermal setup rate;
- solver completion rate;
- numerical benchmark correctness;
- false-acceptance rate on seeded invalid cases;
- physical validation error (only when independent measurements exist).

Compare at least three strategies in the post-hackathon research programme:

A. LLM-only setup generation.  
B. Schema-constrained generation.  
C. Retrieval-grounded, schema-constrained generation with independent deterministic assurance.

Keep failed, rejected, timed-out and invalid cases in the denominator. Do not report only successful runs.

---

# 4. API and persistence additions

## 4.1 Extend Section 8.2 — Core database entities

Keep every original entity. Add the following entities after `Artifact` as the implementation matures:

| Entity | Minimum fields | MVP availability |
|---|---|---|
| `EvidenceRecord` | evidence_id, evidence_type, source_type, source_ref, source_revision, date, content_hash, parent_entity_id | P0 minimal |
| `VerificationRecord` | verification_id, run_id, benchmark_id, check_name, status, metric, threshold, evidence_id | P0 minimal |
| `PhysicalInstance` | physical_instance_id, component_type, serial/lot alias, design_revision, configuration, identity_source | P1 |
| `TestDataset` | dataset_id, physical_instance_id, test_rig, procedure_revision, operating_conditions, raw_hash, processed_hash | P1 |
| `MeasurementChannel` | channel_id, dataset_id, quantity, unit, sensor_type, position/frame, calibration, uncertainty, sample_rate | P1 |
| `CalibrationRecord` | calibration_id, model_revision, parameter_set, method, calibration_dataset_ids, identifiability, posterior/range, reviewer | P1/P2 |
| `ValidationRecord` | validation_id, model_revision, independent_dataset_id, intended_use_domain, metrics, uncertainty, decision | P1 |
| `UncertaintyStudy` | study_id, input_ranges/distributions, sampling_method, seed, sample_count, sensitivity, prediction_range | P1/P2 |
| `ApprovalRecord` | approval_id, entity_revision, reviewer_role, decision, limitations, timestamp | P1 |

Use migrations and schema versions. Do not add every advanced table to the 24-hour scope if it blocks the working pipeline; P0 may store a small typed evidence JSON document linked to the existing run/artifact entities.

## 4.2 Add Section 8.5 — Dependency graph and invalidation

Represent dependencies from requirements, geometry, material, load case, mesh, solver, calibration and result. When one node changes:

- preserve the previous node and all previous results;
- mark dependent downstream artifacts `stale` or `requires_recompute`;
- recompute only affected steps where possible;
- record why a cached result was reused or invalidated;
- never show a stale result as the latest evaluation.

A new geometry revision must not silently inherit validation from a previous geometry. Revalidation scope should be determined by the changed geometry/parameter and affected physical assumptions.

## 4.3 Add API endpoints (post-MVP unless needed earlier)

- `POST /api/evidence` — register source/evidence metadata.
- `GET /api/designs/{design_id}/evidence` — retrieve traceability chain.
- `POST /api/verification/run` — run configured deterministic checks.
- `POST /api/tests/import` — register physical test data and metadata.
- `POST /api/models/{model_id}/calibrate` — create a calibration job; never overwrite model revision.
- `POST /api/models/{model_id}/validate` — compare a model revision with an independent dataset.
- `GET /api/models/{model_id}/maturity` — return evidence-derived maturity and limitations.
- `POST /api/uncertainty/studies` — start a sensitivity/UQ study.

Every endpoint must enforce project access, typed schema validation, artifact checksums and audit logging. Do not expose file-system paths or execute user-supplied shell commands.

---

# 5. Exact phase-by-phase implementation changes

This section is the authoritative placement guide for adding the new work to the original Section 11 timeline. The original hour allocations remain indicative; do not mark a phase complete until its exit evidence exists.

## Phase 0 — Environment and engineering preflight (original Hours 0–2)

**Add tasks:**

1. Correct and freeze unit conventions, including thermal conductivity `W/(m·K)`.
2. Create one structural analytical reference case and one 1D steady-state thermal analytical reference case.
3. Record reference solution, input units, expected outputs and acceptable comparison tolerance before running the solver.
4. Run a unit-conversion test (e.g., mm↔m, MPa↔Pa, °C↔K for absolute temperatures, N↔kN).
5. Add a small invalid-input fixture set: missing units, out-of-range material property, absent load region, absent support region and invalid geometry.
6. Verify that the selected solver binaries, versions and command-line options are recorded.

**Acceptance gate additions:**

- Structural and thermal reference results are stored with inputs and expected values.
- Unit tests detect a deliberate unit mismatch.
- The invalid fixtures are rejected before solver execution where applicable.
- The team knows which output fields the solver can actually provide and which fields are not implemented.

**Do not add:** physical sensors, fatigue, contact, ROM, AAS or cloud services to this phase.

## Phase 1 — Project foundation and contracts (original Hours 2–4)

**Add tasks:**

1. Add schema versions to the engineering request, result and artifact manifest.
2. Add evidence-source fields and assumption status to the material, load, boundary-condition and result records.
3. Add the maturity enum and deterministic state-transition rules.
4. Persist solver version, generator version, code commit (if available), input hashes and unit conversion metadata.
5. Add a minimal `VerificationRecord` and evidence manifest linked to each simulation run.

**Acceptance gate additions:**

- A run can be traced to the requirement/design revision, material snapshot, load case, mesh settings and solver version.
- Missing provenance is represented as `not_available` or `demo_assumption`, never silently as measured/verified.
- The API rejects unrecognised maturity labels and invalid status transitions.

## Phase 2 — CAD and geometry generation (original Hours 4–7)

**Add tasks:**

1. Define stable semantic region IDs for protected interfaces, loads, supports, pressure regions, thermal hot/sink regions and non-design regions.
2. Add geometry invariants for each component profile: protected dimensions, bolt patterns, bores, threads/seat, gaps/clearances and design-envelope bounds as applicable.
3. Persist region mapping, invariant results and geometry hash for every generated model.
4. Add one deliberate invalid-parameter test per component.
5. Record material/manufacturing assumptions associated with each geometry template.

**Acceptance gate additions:**

- Required semantic regions exist and contain the expected faces/solids/elements.
- Protected dimensions pass configured tolerance checks after regeneration.
- Invalid candidate geometry is rejected before meshing.
- STEP export reopens and retains required geometry; visual mesh is not mislabelled as editable CAD.

## Phase 3 — Meshing and physics adapters (original Hours 7–11)

**Add tasks:**

1. Add a pre-solver assurance stage for units, materials, named regions, boundary-condition compatibility and mesh-quality thresholds.
2. Record element family/order, element count, node count, quality metrics, physical group membership and mesh settings.
3. Add result-parser checks for missing, NaN/Inf or inconsistent fields.
4. Add global reaction balance for applicable structural static cases and heat/energy balance for applicable thermal cases.
5. Run a mesh-refinement study for the flagship structural benchmark and record the trend for the actual decision quantity (e.g., displacement or region stress), not only a visually smooth plot.
6. Add an independent expected-response check where possible (e.g., direction of displacement or monotonic trend with load).
7. Ensure failed runs preserve logs and diagnostic status.

**Acceptance gate additions:**

- The analytical structural and thermal benchmarks pass their predeclared tolerances.
- The flagship structural result has a recorded mesh-convergence status (passed, failed or inconclusive).
- The solver cannot run when required named regions, units or material fields fail validation.
- A solver exit code without parseable, finite and unit-tagged results is not a successful evaluation.
- Numerical verification status is separate from experimental validation status.

## Phase 4 — Generative candidate loop and optimisation (original Hours 11–15)

**Add tasks:**

1. Ensure baseline and candidate runs use the same declared material, loads, supports, solver version and comparable mesh policy.
2. Record whether candidate mesh differences could influence comparisons.
3. Add a small sensitivity screen for one or two high-impact parameters only if time permits; otherwise keep as P1.
4. Expose the failed/rejected candidate categories and retain all candidate records.
5. Add deterministic seed and sampling method to each optimisation run.
6. Keep robust/chance-constrained optimisation as P2 until input distributions are supported by evidence.

**Acceptance gate additions:**

- No unevaluated candidate is ranked as feasible or best.
- Every objective and constraint has a source or is labelled as a demonstration assumption.
- Baseline/candidate comparison includes geometry and solver configuration provenance.
- The random seed and candidate budget reproduce the same search proposal set (subject to solver/platform determinism limits, which must be documented).

## Phase 5 — 3D visualisation and dynamic animation (original Hours 14–18)

**Add tasks:**

1. Display the maturity label next to results.
2. Show source/assumption labels for material, loads and boundary conditions.
3. Show verification status, mesh-convergence status and any warnings beside the contour plot.
4. Distinguish simulation result, visualization ramp, reduced-order output and stored illustrative result.
5. Provide a result-provenance panel showing solver, mesh, design revision, run ID and input hash.

**Acceptance gate additions:**

- A user can identify whether the displayed field is solver-derived, analytical, reduced-order or illustrative.
- The UI does not show “validated” or “twin” status when physical validation data is absent.
- Contours show units and whether data is nodal or elemental.

## Phase 6 — AI assistant, explanation and cost model (original Hours 17–20)

**Add tasks:**

1. Add retrieval over the team's approved, versioned engineering case library.
2. Have the LLM produce a draft structured setup with source/provenance labels and missing-field list.
3. Route draft values through Pydantic and deterministic engineering validation.
4. Require confirmation for assumptions affecting material, loads, supports, contacts, thermal conditions or limits.
5. Ground explanations in stored run/result/evidence IDs.
6. Run seeded-invalid setup tests to measure detection and false acceptance.

**Acceptance gate additions:**

- The LLM cannot alter maturity, verification or validation states.
- Unsupported solver profile requests are blocked.
- Every explanation can be traced to stored computed/measured values or clearly labelled assumptions.
- The no-LLM mode still runs the deterministic workflow.

## Phase 7 — End-to-end integration and validation (original Hours 20–22)

**Add tasks:**

1. Run the main vertical slice from requirements to exported STEP and evidence manifest.
2. Run the seeded invalid-case suite.
3. Verify that stale results are marked when geometry/material/load/solver inputs change.
4. Check that report metrics match stored result JSON and field payloads.
5. Capture benchmark outputs, mesh study and known limitations.
6. Record all failed, timed-out, rejected and inconclusive cases.

**Acceptance gate additions:**

- Zero known seeded critical-invalid cases are silently accepted in the tested P0 suite; if a case cannot yet be detected, it must be documented as a known risk and block the affected maturity claim.
- Every displayed result has units, method label, run ID and provenance.
- No stale result appears as the current candidate evaluation.
- Physical validation status remains `not_validated` unless an independent physical dataset was actually used.

## Phase 8 — Demo preparation and freeze (original Hours 22–24)

**Add tasks:**

1. Present one complete flagship workflow, preferably the alloy-wheel vertical slice as already proposed in v1.0.
2. Show the engineering assumptions and the verification result, not only the 3D animation.
3. Show one deliberately rejected invalid configuration to demonstrate guardrails.
4. Show the three component profiles with honest capability labels.
5. Label every stored/demo value as stored or illustrative; label every live result as computed by the stated method.
6. Present the post-hackathon validation roadmap without suggesting these capabilities already exist.

**Acceptance gate additions:**

- The team can explain the exact model's intended use and limitations.
- No production, certification, fatigue-life or calibrated-digital-twin claim is made without the relevant evidence.

---

# 6. Post-hackathon research and industrial roadmap

Add this sequence to Section 18. These are not additions to the 24-hour task list.

| Phase | Capability | Required deliverables and exit evidence | Claim boundary |
|---|---|---|---|
| **R1 — Benchmark foundation** | Freeze AutoTwin-ComponentBench v0.1 for W0/C0/S0 and the P0 flagship case. | Geometry/parameter fixtures; solver decks; unit tests; reference solutions; versioned scripts; benchmark report with all failures. | Numerical/analytical verification only. |
| **R2 — Component-specific physical models** | Add wheel W2/W3, caliper C2/C3 and spark-plug S2/S3 profiles as data/access permit. | Component-specific BCs, contact/thermal assumptions, test fixture models and model-domain statements. | No generalisation beyond tested configuration. |
| **R3 — Physical test partnership and data** | Obtain instrumented wheel, caliper and spark-plug datasets or collaborate with a test lab/university/OEM/supplier. | Test plans, physical instance IDs, sensor metadata, uncertainty, repeat tests and data rights. | Do not claim calibration before data quality and identifiability are assessed. |
| **R4 — Model calibration and independent validation** | FEMU/Bayesian or other justified calibration for selected parameters. | Identifiability analysis; calibration/holdout split; residuals; measurement uncertainty; validation report. | Validate only named outputs and operating domain. |
| **R5 — Uncertainty-aware optimisation** | Sensitivity, uncertainty propagation and robust candidate selection. | Sourced input ranges/distributions, sampling plan, sensitivity ranking, robust feasibility and Pareto comparison. | No probability or reliability claim without justified distributions/model. |
| **R6 — Qualified reduced-order models** | POD/reduced-basis or data-driven ROM trained on verified high-fidelity runs. | Holdout field errors, stability, OOD detection, latency on target hardware and high-fidelity fallback. | No “real-time” claim until measured on target hardware and cadence. |
| **R7 — Digital thread/interoperability** | Map evidence records to AAS and relevant ISO 23247 concepts. | Semantic mappings, versioned submodels, API tests, registry/discovery and exchange demonstration. | Interoperability does not validate physics. |
| **R8 — Industrial pilot** | Link unique component instances, test/production data and governed model updates. | Update cadence, data-quality monitoring, drift detection, access controls, approval, rollback and measured value. | No autonomous release or certification without authorised engineering governance. |

## 6.1 Original research hypotheses to retain and implement as experiments

| ID | Hypothesis | Baseline comparison | Primary metrics |
|---|---|---|---|
| H1 | Retrieval-grounded, schema-constrained setup reduces unsafe/invalid solver configurations. | LLM-only vs schema-only vs retrieval + schema + assurance. | Critical setup error rate; false acceptance; missing-input detection. |
| H2 | Functional interface constraints improve automotive CAD usability over generic text-to-CAD. | Generic text-to-CAD vs component-template constraints. | Protected-interface pass rate; dimensional error; valid solid rate; clearance violations. |
| H3 | Independent deterministic assurance reduces false acceptance more than LLM reflection alone. | LLM self-review vs independent assurance gates. | False-acceptance rate on seeded cases; verification coverage; false-reject rate. |
| H4 | Test-aware calibration improves prediction on unseen physical cases. | Uncalibrated vs calibrated model on held-out measurements. | Prediction error, uncertainty coverage, parameter identifiability. |
| H5 | Uncertainty-aware search selects more robust candidates than nominal Pareto search. | Nominal optimisation vs robust/chance-constrained search. | Robust feasible fraction, worst violation, objective trade-off. |
| H6 | A qualified ROM reduces runtime without changing engineering decisions inside its declared envelope. | Full-order solver vs ROM + error monitor. | Latency, field error, constraint misclassification, OOD detection and fallback success. |

Pre-register intended use, dataset split, metrics and failure definitions before comparing approaches. Do not select metrics after seeing which model wins.

---

# 7. Quality, security and operational controls to add to Sections 13–14

## 7.1 Failure-oriented test suite

Add the following tests to Section 13. A deliberate invalid case must have a known expected response.

| ID | Defect injected | Expected behaviour |
|---|---|---|
| F01 | STEP unit missing/ambiguous | Block analysis and require explicit unit confirmation. |
| F02 | Incorrect unit scale | Dimensional/schema test fails before solver execution. |
| F03 | Material ID missing or property outside valid range | Reject dependent analysis or require reviewed material record. |
| F04 | Load region missing/empty | Reject simulation setup. |
| F05 | Support applied to wrong semantic region | Reject if invariant/region compatibility check detects it; otherwise record unresolved risk and require engineer approval. |
| F06 | Invalid physical group mapping | Reject before solver. |
| F07 | Poor mesh quality or negative/invalid element Jacobian | Reject or mark unqualified according to declared thresholds. |
| F08 | Solver exits successfully but output is incomplete | Parser rejects result. |
| F09 | Structural reaction imbalance exceeds threshold | Mark verification failed/inconclusive; do not mark numerically verified. |
| F10 | Thermal heat balance/sign error | Mark verification failed/inconclusive. |
| F11 | Validation uses same data as calibration | Reject validation status; label calibration-only. |
| F12 | New inputs outside ROM domain | Trigger full solver or engineer review. |
| F13 | Material/load/geometry changed after a result | Mark dependent result stale. |
| F14 | User uploads path or command-like filename | Store safely using generated IDs; never use shell-concatenated input. |

Thresholds must be established for the selected benchmark and intended use. Do not invent one universal mesh-quality or balance tolerance for every solver/profile.

## 7.2 Add to Section 14 risk register

- **Silent physics error:** a solver runs but loads, supports, materials or equations are wrong. Mitigation: deterministic setup contracts, independent checks and seeded cases.
- **False validation:** calibration data is reused as validation. Mitigation: dataset role labels and enforced independent split.
- **Material/process mismatch:** nominal material card omits batch, heat-treatment or manufacturing effects. Mitigation: material-condition provenance and limitations.
- **Measurement error:** fixture compliance, sensor placement or calibration contaminates comparison. Mitigation: test metadata and measurement uncertainty.
- **Model drift/stale evidence:** changed inputs leave old results visible. Mitigation: dependency graph, hashes and invalidation.
- **ROM extrapolation:** surrogate is queried outside its training/validated domain. Mitigation: OOD detector and full-order fallback.
- **Overstated maturity:** interface labels imply physical validation/certification. Mitigation: evidence-derived maturity and prohibited-claim checklist.
- **Premature interoperability:** standards integration consumes effort before physics is trustworthy. Mitigation: internal schemas first, standards mapping after P1 evidence.
- **Data rights/confidentiality:** OEM/test datasets may be restricted. Mitigation: access control, rights metadata, approved storage and synthetic/public benchmark separation.

---

# 8. Standards and applicability register — add to Section 19

Use standards as applicable engineering guidance; do not claim compliance from merely listing a standard. Obtain the current licensed edition, verify exact scope and applicability, and involve the responsible design/homologation authority before making compliance claims.

| Standard | Current reference/status checked for this addendum | AutoTwin relevance | Limitation |
|---|---|---|---|
| **ASME V&V 10–2019** | Verification and validation in computational solid mechanics. | Structural solver/model credibility for wheel and caliper. | Must be applied to a defined model and intended use; not automatic certification. |
| **ASME V&V 20–2009** | Verification and validation in computational fluid dynamics and heat transfer. | Applicable thermal/CFD validation work where its scope fits. | Do not assume it prescribes every solid-conduction workflow. |
| **ASME VVUQ 10.2–2021** | Role of UQ in V&V of computational solid mechanics models. | Uncertainty in structural predictions. | Requires model- and data-specific implementation. |
| **ASME VVUQ 20.1–2024** | Multivariate metric for validation. | Potential validation metrics for field quantities. | Select metrics appropriate to the quantities and measurement data. |
| **ASME VVUQ 50.1–2025** | Guide to a model life-cycle approach incorporating V&V and UQ; current ASME catalogue lists the 2025 edition. | Organising requirements, development, deployment, use/maintenance and retirement evidence. | Guidance for model lifecycle; not a substitute for the component-specific technical standards or physical tests. |
| **IEC 63278-1:2023** | Asset Administration Shell structure. | Future standardised asset information/service exchange. | Does not validate CAD, FEA or thermal physics. |
| **ISO 23247-5:2026** | Digital thread for manufacturing digital twins; published June 2026. | Lifecycle linkage of design, planning, production and testing evidence. | Does not specify AutoTwin's component constitutive model. |
| **ISO 23247-6:2026** | Digital twin composition; published 2026. | Future composition/interoperability of twin systems. | Does not replace model V&V or data quality. |
| **SAE J328_202601** | Passenger-car/light-truck wheel performance and fatigue test procedures; reaffirmed January 2026. | Possible reference for relevant passenger-car/light-truck wheel profile. | Material and vehicle-class scope applies; heavy-truck wheels are directed to a separate SAE practice. |
| **SAE J2562_202107** | Biaxial wheel fatigue test recommended practice. | Biaxial wheel test setup reference for applicable passenger car/light truck uses. | Check the current SAE record and exact application before use. |
| **SAE J267** | Heavy-truck wheel scope referenced by SAE J328. | Investigate separately for heavy-truck wheel profiles. | Do not infer HCV compliance from passenger-car standards or ARAI paper alone. |

Official source records:

- ASME VVUQ standards catalogue: https://www.asme.org/codes-standards/vvuq-standards
- ASME VVUQ 50.1: https://www.asme.org/codes-standards/find-codes-standards/vvuq501-vvuq-50-1-guide-to-a-model-life-cycle-approach-that-incorporates-verification-validation-and-uncertainty-quantification
- IEC 63278-1:2023: https://webstore.iec.ch/en/publication/65628
- ISO 23247-5:2026: https://www.iso.org/standard/87425.html
- ISO 23247-6:2026: https://www.iso.org/standard/87426.html
- SAE J328_202601: https://saemobilus.sae.org/standards/j328_202601-wheels-passenger-car-light-truck-performance-requirements-test-procedures
- SAE J2562_202107: https://saemobilus.sae.org/standards/j2562_202107-biaxial-wheel-fatigue-test

**Status correction:** the earlier research-grade review described ASME VVUQ 50.1 as under development. This is no longer current as of 3 November 2026: ASME's catalogue lists VVUQ 50.1–2025. Update that statement in the research-grade review and any derivative documents.

---

# 9. Replace/extend Section 20 — Definition of done and claim control

A candidate may be called **Simulation Evaluated** only when:

1. Geometry generation/import succeeded.
2. Geometry and protected-interface checks passed.
3. Required mesh creation succeeded, or a declared analytical/reduced-order method was selected.
4. The chosen solver/model completed and result parsing passed.
5. Units, assumptions, input provenance and method label are stored.
6. Configured constraints were evaluated from actual computed/analytical values.
7. The result, inputs, logs and artifacts are reproducible from stored metadata within documented numerical/platform limits.

A candidate may be called **Numerically Verified** only when its applicable analytical/code benchmark, mesh/solution verification and physical consistency checks pass.

A model may be called **Experimentally Validated** only when independent physical evidence, measurement metadata, uncertainty and validation metrics are recorded for a named intended-use domain.

A model may be called a **Calibrated Component Twin** only when an identified physical instance is linked to measured data, the calibration method and updated parameters are recorded, and independent validation is completed.

A candidate marked “feasible under configured model” is not automatically safe, certified, manufacturable, homologated or approved for road use.

### Prohibited claims until evidence exists

- “Production-ready automotive CAE”
- “Certified wheel/caliper/spark plug”
- “Fatigue life validated” without independent fatigue validation
- “Real-time digital twin” without measured update cadence and target-hardware latency
- “AI accuracy” inferred from CAD execution or solver convergence rates
- “XX% cost/time reduction” without a measured, documented baseline and comparable workflow
- “Calibrated twin” without an identified physical instance and documented calibration

---

# 10. Updated reference set to append to Section 19

These references directly support the additions in this addendum. The research-grade review contains a larger evidence matrix; this shorter list identifies the most relevant implementation references.

## Component physics and experiments

1. Zanchini et al. (2023), *Fatigue and failure analysis of aluminium and composite automotive wheel rims: Experimental and numerical investigation*. https://doi.org/10.1016/j.engfailanal.2023.107064
2. Venturini et al. (2024), *An automotive steel wheel digital twin for failure identification under accelerated fatigue tests*. https://doi.org/10.1016/j.engfailanal.2024.107979
3. Venturini et al. (2024), *A tyre-rim interaction digital twin for biaxial loading conditions*. https://doi.org/10.1016/j.mechmachtheory.2023.105491
4. Bakal et al. (2024), *Development of India Specific Biaxial Test Cycle for Fatigue Testing of Wheel Rims and Wheel Hub Bearings for Heavy Commercial Vehicles*. https://doi.org/10.4271/2024-26-0322
5. Vecchiato et al. (2024), *Design, Topology Optimization, Manufacturing and Testing of a Brake Caliper Made of Scalmalloy for Formula SAE Race Cars*. https://doi.org/10.3390/vehicles6030075
6. Tirovic et al. (2012), *Structural analysis of a commercial vehicle disc brake caliper*. https://doi.org/10.1177/0954407011423447
7. Osaka et al. (2020), *Simulation and Experimental Validation of Spark Plug Temperature Coupled with Combustion in Four-Stroke Gasoline Engine*. https://www.jstage.jst.go.jp/article/tse/28/3/28_29/_article
8. Tahri et al. (2020), *New Design of Copper–Inconel 601 Ground Electrode Spark Plug Based on a Thermo-Mechanical Model*. https://doi.org/10.3390/en13153798
9. Tilz et al. (2023), *Novel measurement techniques ... spark plug temperature measurement ... in situ monitoring*. https://doi.org/10.1016/j.wear.2023.204730
10. Breden et al. (2019), *High-Fidelity Numerical Modeling of Spark Plug Erosion*. https://doi.org/10.4271/2019-01-0215

## CAD/AI/CAE automation and engineering assurance

11. Guan et al. (2025), *CAD-Coder: Text-to-CAD Generation with Chain-of-Thought and Geometric Reward*. https://doi.org/10.52202/085713-1999
12. Xie and Ju (2025), *Text-to-CadQuery: A New Paradigm for CAD Generation with Scalable Large Model Capabilities*. https://arxiv.org/abs/2505.06507
13. Brenner et al. (2024), *FEABench: Evaluating Language Models on Real World Physics Reasoning Ability*. https://research.google/pubs/feabench-evaluating-language-models-on-real-world-physics-reasoning-ability/
14. Hou et al. (2025), *AutoFEA: Enhancing AI Copilot by Integrating Finite Element Analysis Using Large Language Models with Graph Neural Networks*. https://doi.org/10.1609/aaai.v39i22.34582
15. Deotale et al. (2026), *ALL-FEM: Agentic Large Language Models fine-tuned for finite element methods*. https://doi.org/10.1016/j.cma.2026.118985
16. Chen et al. (2025), *Finite Element Model Updating for Material Model Calibration: A Review and Guide to Practice*. https://doi.org/10.1007/s11831-024-10200-9
17. Bitencourt et al. (2025), *Verification and validation of digital twins: a systematic literature review for manufacturing applications*. https://doi.org/10.1080/00207543.2024.2357741
18. Kramer and Qian (2026), *Reduced-order modeling for engineering systems: survey and opportunities for digital twins*. https://doi.org/10.1007/s00158-026-04310-0
19. Zech et al. (2026), *Model-based digital twin engineering: insights, challenges, and future directions*. https://doi.org/10.1007/s10270-026-01368-8

## OEM/industrial practice

20. Fietkau, Kistner and Munier (2020), *Virtual powertrain development*. https://doi.org/10.1177/0954407020936797
21. Mokudai et al. (2021), *Digital technologies as lean augmentation: a preliminary study of Japanese automotive manufacturers*. https://doi.org/10.1504/IJATM.2021.116607
22. BMW Group, iFACTORY / Virtual Factory official material: https://www.bmwgroup.com/
23. Mercedes-Benz, MO360 / Digital Factory Campus official material: https://group.mercedes-benz.com/
24. Toyota Motor Corporation, Integrated Report 2024: https://global.toyota/en/ir/library/annual/
25. FANUC, Smart Digital Twin official material: https://www.fanuc.com/

**Source discipline:** the academic papers above are not all equivalent evidence. Peer-reviewed full-text inspection, publisher/author records, preprints and company/standard sources must remain labelled separately in future reports. Company pages describe the company's stated practice; they are not independent proof of component-level simulation accuracy.

---

# 11. Final implementation decision register

| Decision | Adopt now? | Reason |
|---|---:|---|
| Add evidence provenance and maturity labels | **Yes — P0** | Prevent unsupported engineering claims and preserve reproducibility. |
| Add deterministic pre/post-solver assurance | **Yes — P0** | Detect invalid setup and incomplete results. |
| Add component-specific W/C/S validation ladders | **Yes — document now; build progressively** | Prevent one generic physics profile from being overstated. |
| Add seeded failure tests | **Yes — P0** | Measure false acceptance, not only successful runs. |
| Add retrieval-guided simulation templates | **P1** | Better than unrestricted LLM-generated solver decks; requires curated cases. |
| Add physical test import/calibration | **P1/P2** | Requires test access, rights, metadata and independent validation design. |
| Add robust optimisation/UQ | **P1/P2** | Requires supported uncertainty ranges/distributions and repeatable models. |
| Add ROM/PINN inference | **P2** | Requires verified datasets, holdout testing, OOD detection and fallback. |
| Add AAS/ISO 23247 mapping | **P2** | Build internal data contracts first; mapping cannot validate physics. |
| Add autonomous physical control/release | **No for current scope** | Requires independent safety, cybersecurity and engineering-authority processes. |

## Final direction

Keep the existing AutoTwin v1.0 specification as the implementation authority. Merge this addendum into the exact sections and phases listed above to create v1.1. The MVP should demonstrate one honest, reproducible requirement-to-CAD-to-simulation-to-candidate workflow, with three component profiles at clearly disclosed maturity levels. The research roadmap should then earn higher maturity through component-specific physical testing, calibration, uncertainty, robust design selection and a staged digital thread.

**The quality target is not the largest technology stack. It is the strongest reproducible evidence that AutoTwin's engineering decisions are correct within a clearly stated domain.**
