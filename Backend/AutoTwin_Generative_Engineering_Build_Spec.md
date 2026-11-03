## Project build specification, technical architecture, implementation phases and IDE-agent handoff

**Document version:** 1.0  
**Prepared:** 2 November 2026  
**Target build window:** 24-hour hackathon  
**Status:** Working implementation specification  
**Working product name:** AutoTwin (name can be changed without changing the architecture)

## Contents

0. Important context and interpretation of the problem statement
1. Product vision and primary user journey
2. Hackathon scope and component selection
3. Generative engineering: how the platform creates designs
4. Engineering data, units and simulation contracts
5. Technical architecture and selected stack
6. Dynamic animation and visualization requirements
7. AI assistant: role, input contract and guardrails
8. API design and data persistence
9. Prototype cost and time estimator
10. Installation and local development setup
11. Phase-by-phase implementation plan
12. 24-hour timeline and team responsibilities
13. Testing strategy and definition of done
14. Risk register and fallback decisions
15. Demo storyline for judges
16. Explicit instructions for the IDE coding agent
17. Project tracking template
18. Future roadmap after the hackathon
19. References and implementation documentation
20. Final definition of the hackathon deliverable

---


> **Instruction to the IDE coding agent:** Treat this document as the project's source of truth. Read it fully before creating files or writing code. Build incrementally in the listed phases. Do not silently remove requirements, invent engineering values, fake simulation output, or mark a phase complete without passing its acceptance criteria.

---

# 0. Important context and interpretation of the problem statement

The exact official hackathon problem statement has not been included in the project brief available to the implementation team. Therefore, this document records the team's current working interpretation. Before the final pitch, map this interpretation to the official wording supplied by the organizers. Do not claim that the following text is a verbatim quotation from the organizers.

## 0.1 Working problem statement (PS)

Automotive component development often requires engineers to design a part, manufacture a physical prototype, test it, identify weaknesses, modify the design and repeat the process. These iterations consume material, machining capacity, engineering labour, testing time and money.

The proposed solution is an **AI-assisted generative engineering and virtual prototyping platform**. An engineer describes what a component must achieve or uploads an existing CAD design. The platform creates or modifies candidate geometries, evaluates them under defined engineering conditions, identifies weaknesses, explores alternative designs, compares the results and recommends promising candidates for physical prototyping.

The platform should help engineers:

- Explore more design possibilities than they could practically create manually in the same amount of time.
- Virtually test a component under multiple defined engineering parameters and load cases.
- Generate new candidate designs from requirements, not only edit an uploaded design.
- Improve an existing design through parameter changes and optimization.
- Visualize simulation and geometry changes dynamically in an interactive 3D workspace.
- Reduce avoidable early physical prototype iterations, repetitive setup work and development cost.
- Keep an auditable record of requirements, design versions, simulation inputs, results and selected candidates.

## 0.2 What the product is - and is not

**It is:** a virtual product-development environment combining parametric CAD generation, engineering simulation, constrained design exploration, result interpretation and interactive 3D visualization.

**It is not:** only a 3D viewer, a post-manufacturing inspection dashboard, a chatbot that invents CAD, or a production-certified automotive CAE system.

A virtual model before a physical part exists is more precisely a virtual prototype or virtual product model. It becomes a data-connected digital twin when it is linked to a physical counterpart and updated using measured physical test or operational data. For the hackathon, the product is a **simulation-driven virtual prototyping twin**. The architecture should allow physical test data to be added later.

## 0.3 Core product statement

> **From engineering requirements to newly generated, virtually tested automotive component designs.**

The platform should not only tell engineers whether a design is good or bad. It should explore the design space, generate alternatives, test them, explain trade-offs and help engineers select the next candidate to prototype physically.

---

# 1. Product vision and primary user journey

## 1.1 Two design modes are mandatory

### Mode A - Improve an existing design

1. Engineer chooses a component profile.
2. Engineer uploads a supported CAD model (STEP is the preferred exchange format).
3. Platform imports and validates the geometry.
4. Engineer defines or confirms material, loads, supports, design limits and objectives.
5. Platform simulates the baseline design.
6. The system identifies weak regions or opportunities for improvement from calculated results.
7. The generative engine changes permitted design variables or explores the allowed design space.
8. Candidate geometries are generated and simulated again.
9. The platform ranks feasible candidates and displays the trade-offs.
10. Engineer selects a candidate and exports the generated CAD model and report.

### Mode B - Generate a new design from requirements

1. Engineer selects a component type and starts a new design.
2. Engineer enters functional requirements, dimensions, interfaces, materials, loads, constraints and manufacturing method.
3. The platform validates that enough engineering information exists to generate a meaningful design.
4. A component-specific parametric template or design grammar creates new candidate geometries inside a defined design envelope.
5. Candidate designs are meshed and simulated.
6. The optimization engine explores different candidates.
7. Feasible candidates are ranked by objectives such as mass, stress, deformation, thermal behaviour and manufacturability.
8. Engineer reviews the generated designs, selects one and exports it for detailed engineering and physical validation.

**Important:** arbitrary STEP geometry is not automatically editable. Existing CAD upload is supported for viewing and analysis, but automatic geometry regeneration requires a matching parametric template, editable feature mapping or a separately implemented geometry-reconstruction workflow. The MVP must explain this limitation in the UI instead of pretending every imported model can be redesigned automatically.

## 1.2 End-to-end product flow

`Create project -> Select component -> Choose design mode -> Define requirements -> Validate inputs -> Generate/import geometry -> Mesh -> Simulate -> Optimize/generate candidates -> Re-simulate -> Compare -> Animate -> Export and report`

## 1.3 User-facing screens

1. **Project dashboard:** recent projects, components, jobs, candidate counts and status.
2. **Component selection:** Alloy Wheel, Brake Caliper and Spark Plug.
3. **Design-mode selection:** Improve Existing Design or Generate New Design.
4. **Engineering setup:** geometry, units, material, load cases, supports, thermal conditions, objectives and limits.
5. **Live engineering workspace:** large 3D viewport, simulation controls, job progress and AI findings.
6. **Candidate comparison:** original/baseline and candidate designs side-by-side with engineering metrics.
7. **Design details:** parameter values, material, geometry version, solver configuration and validation status.
8. **Export/report:** STEP export, GLB preview, simulation report and assumptions.

## 1.4 Main workspace layout

- **Left panel:** project/component, design variables, material, boundary conditions, objectives and constraints.
- **Centre panel:** interactive 3D geometry, mesh, loads/supports, stress/temperature maps and dynamic playback.
- **Right panel:** engineering results, feasibility, candidate ranking, AI explanation and warnings.
- **Bottom timeline:** geometry generation stages, simulation load/iteration sequence, optimization generations and replay controls.

The application is desktop-first for engineering use. Keep the layout responsive enough for laptop screens, but do not sacrifice viewport size for mobile-specific features during the hackathon.

---

# 2. Hackathon scope and component selection

The hackathon build window is **24 hours**. The scope is therefore three component profiles using one shared platform-not three separate applications and not a complete automotive engineering suite.

## 2.1 The three selected components

1. **Alloy Wheel** - structural engineering and generative geometry.
2. **Brake Caliper** - structural engineering and generative geometry.
3. **Spark Plug** - thermal engineering and generative geometry.

The components were chosen because they are familiar automotive parts, easy for judges to understand, and demonstrate more than one engineering analysis domain.

## 2.2 Shared engine, component-specific profiles

All three profiles should reuse:

- Project and design-version management.
- CAD import/export and geometry validation.
- Design-space/parameter validation.
- Meshing orchestration.
- Simulation job lifecycle and logging.
- Candidate generation and ranking infrastructure.
- Result normalization and visualization payloads.
- AI requirement parsing and explanation.
- Cost/time estimation and report generation.

Each component must provide its own:

- Parameter schema and CAD generator.
- Preserved interfaces and non-design regions.
- Material/engineering property requirements.
- Boundary-condition schema.
- Solver profile and output metrics.
- Objective functions and constraints.

Do not use the same load case or same physical model for all three components.

## 2.3 Component profile A - Alloy Wheel

**Product objective:** Explore wheel designs that reduce mass while satisfying specified structural limits and preserving all required vehicle interfaces.

### Required preserved regions

- Hub centre and mounting interface.
- Bolt-hole positions and dimensions.
- Rim/barrel and tyre/bead-seat interfaces.
- Any mounting geometry specified as non-design space.

### Example design variables

- Spoke count (discrete, within a validated range).
- Spoke width/thickness.
- Spoke curvature or profile parameters.
- Hub transition radius.
- Local rib/fillet dimensions.
- Selected web/connection geometry parameters.

### Engineering inputs

- Wheel geometry and required interfaces.
- Material grade and properties (elastic modulus, Poisson's ratio, density, yield strength; fatigue properties only if a validated fatigue workflow is actually implemented).
- Vehicle/wheel load assumptions from the official PS, supplied engineering data or a clearly labelled demonstration fixture.
- Fixed supports/contact representations appropriate to the selected simplified load case.
- Allowed stress, displacement and design-envelope limits.
- Manufacturing method (e.g. cast, forged or machined) where the generator can enforce relevant constraints.

### MVP analysis

- Linear static structural analysis.
- At least one configured representative load case; if time allows, add radial and lateral/braking-equivalent cases as separate runs.
- Outputs: mass, maximum von Mises stress, maximum displacement, material yield margin/factor of safety (only when yield strength and safety-factor basis are explicitly provided), compliance/strain-energy proxy and constraint pass/fail.

### MVP generative behaviour

Generate several alternative spoke/hub configurations from a parameterized wheel template. The generator must preserve mounting and rim interfaces. Run each candidate through the same solver configuration before ranking it.

### Not in MVP

- Full wheel fatigue certification.
- Impact/curb testing.
- Full tyre/wheel contact physics.
- Regulatory or road-use certification.

## 2.4 Component profile B - Brake Caliper

**Product objective:** Explore caliper-body designs that reduce unnecessary mass while meeting defined structural stress and deformation limits.

### Required preserved regions

- Mounting ears/bolt holes.
- Piston bore interfaces.
- Pad-contact/abutment regions.
- Hydraulic/assembly interfaces represented in the simplified CAD template.

### Example design variables

- Bridge thickness and bridge contour parameters.
- Body wall thickness.
- Rib count, position and thickness.
- Local fillet and transition radii.
- Selected body/web geometry parameters.

### Engineering inputs

- Caliper geometry and interfaces.
- Material properties and yield limit.
- Hydraulic pressure or an equivalent resultant piston/clamping load, with units and assumptions stated.
- Mounting support locations and pad reaction representation.
- Stress and displacement limits.
- Manufacturing method and minimum wall/thickness constraints.

### MVP analysis

- Simplified linear static structural analysis of the caliper body.
- Use a clearly documented equivalent load model and mounting constraints.
- Outputs: mass, maximum von Mises stress, displacement, yield margin/factor of safety where justified, and constraint pass/fail.

### MVP generative behaviour

Generate alternatives by modifying bridge/body/rib parameters while preserving mounting and piston/pad interfaces. Re-run the solver for generated candidates.

### Not in MVP

- Full hydraulic circuit simulation.
- Detailed piston/seal/pad/disc contact mechanics.
- Brake-fluid flow.
- Full transient brake thermal analysis.
- Fatigue, wear and complete brake-system validation.

## 2.5 Component profile C - Spark Plug

**Product objective:** Explore spark-plug geometry/material configurations that meet defined thermal operating limits while preserving electrical and mechanical interfaces.

### Required preserved regions

- Cylinder-head thread and sealing/seat interface.
- Shell and insulator interface.
- Electrode gap and firing-end geometry.
- Required electrical insulation clearances.

### Example design variables

- Insulator length and selected diameter/profile parameters.
- Centre-electrode dimensions.
- Ground-electrode dimensions and permitted profile changes.
- Shell geometry parameters where the template supports them.
- Material selection from a curated list with known thermal/electrical properties.

### Engineering inputs

- Geometry and interfaces.
- Thermal conductivity and other required material properties.
- Hot-end temperature or heat-flux boundary condition.
- Cylinder-head/seat temperature or thermal contact assumption.
- Cooling/convection boundary conditions if used.
- Allowed component temperature range and engineering limits.
- Electrical/clearance constraints for geometry generation (not an electrical discharge simulation).

### MVP analysis

- Steady-state heat-conduction analysis only.
- Outputs: maximum/minimum temperature, temperature gradient, heat-flow metric, and thermal-constraint pass/fail.
- The UI must label a visualization ramp to the steady-state result as a **visualization**, not a transient thermal simulation.

### Solver strategy

Preferred: use a verified thermal solver path (Elmer is a candidate for heat-transfer analysis; CalculiX may be considered if the exact heat-transfer profile is tested). The team must run a simple thermal benchmark before enabling this profile.

Fallback for the 24-hour demo: a clearly labelled reduced-order thermal network/analytical conduction model with validated equations and explicit assumptions. Do not display reduced-order output as 3D FEA. Do not fabricate a 3D thermal field.

### Not in MVP

- Combustion simulation.
- Spark/ignition discharge simulation.
- Full cylinder pressure/flow simulation.
- Transient engine-cycle thermal simulation unless an actual solver and validated conditions are implemented.

## 2.6 Priority levels

- **P0 - Must work:** all three selectable profiles; CAD/geometry viewer; at least one honest working engineering pipeline; parameter-based candidate generation; candidate comparison; dynamic result visualization; and saved jobs/results. These are required for the demo. Never use fake outputs.
- **P1 - Strong target:** structural pipelines for both the wheel and caliper; a validated thermal profile for the spark plug; multi-objective search; requirements-first generation; STEP export; AI explanations; and the cost estimator. Build these after the P0 pipeline is stable.
- **P2 - Stretch/future:** true topology optimization and organic freeform geometry; ML surrogate models; transient thermal analysis; fatigue; contact/nonlinear analysis; and physical sensor/test-data connections. Do not jeopardize P0/P1 to attempt these.

**Important scope rule:** provide three usable component profiles, but prioritize a complete, tested end-to-end pipeline over a superficial claim that all three are equally advanced. If time is short, show all three profiles and their distinct parameter/analysis workflows while being transparent about which profiles have full solver validation and which use a reduced-order fallback.

---

# 3. Generative engineering: how the platform creates designs

## 3.1 Do not use an LLM as the CAD or physics engine

The LLM should interpret user intent and explain verified results. It must not invent geometry coordinates, loads, material properties or solver results as if they were verified engineering facts.

Use the following separation:

- **LLM:** turns natural-language goals into a structured requirement draft and explains calculated results.
- **CAD generator:** deterministically builds valid geometry from component templates and design variables.
- **Optimizer:** explores allowed variables and ranks candidates.
- **Physics solver:** calculates stress/deformation/temperature for each candidate.
- **Validation layer:** checks geometry, solver completion and engineering constraints.

## 3.2 Two levels of generation

### Level 1 - Parametric generative design (MVP)

Use component-specific CAD templates with explicit variables. The system can create geometrically different designs by changing validated parameters. Use random/LHS sampling or evolutionary optimization to explore candidate combinations.

This is the required 24-hour generation capability because it is testable, deterministic and exportable to STEP.

### Level 2 - Topology optimization / freeform material distribution (stretch/future)

A topology-optimization method can discover non-obvious material layouts within a design envelope while preserving non-design regions and required interfaces. The generated density field usually needs thresholding, smoothing, remeshing and CAD reconstruction before it becomes a manufacturable solid model.

This is valuable but should not be a dependency for the entire hackathon build. If implemented, make it a clearly separated module and validate its mesh/geometry output.

## 3.3 Optimization formulation

Use multi-objective optimization where appropriate. Example objectives:

- Minimize mass.
- Minimize compliance or deformation.
- Minimize peak stress (or maintain it below a limit).
- For spark plug, keep maximum temperature/temperature distribution within a specified operating window.
- Penalize geometry that violates manufacturability rules.

Example constraints:

- Maximum stress <= configured allowable stress.
- Maximum displacement <= configured allowable displacement.
- Mass <= configured maximum (if any).
- Minimum wall thickness >= manufacturing limit.
- Required interfaces remain unchanged.
- Spark-plug temperature stays inside its specified range.

Do not optimize stress, weight or temperature against invented defaults. Every constraint must come from an official problem statement, supplied engineering data, an identified source, or a clearly marked demo fixture.

## 3.4 Candidate exploration loop

1. Receive validated design specification.
2. Generate a candidate parameter vector.
3. Validate parameter bounds and protected dimensions.
4. Build CAD geometry.
5. Check geometry validity, volume, clearances and preserved interfaces.
6. Export STEP and a visualization mesh.
7. Generate a finite-element mesh with named physical regions.
8. Build solver input from the component profile.
9. Run solver in a separate process with timeout and log capture.
10. Parse and normalize results.
11. Evaluate constraints and objectives.
12. Store candidate, geometry hash, solver configuration and metrics.
13. Feed results back to the optimizer.
14. Stop at candidate/evaluation/time budget.
15. Rank feasible candidates and expose Pareto trade-offs.

If a candidate fails geometry or simulation, mark it failed/infeasible with a reason. Do not silently omit it or assign a fabricated score.

## 3.5 24-hour optimizer settings

Use small candidate budgets at first. The exact budget depends on solver speed, mesh size and hardware. Start with a deterministic small design-of-experiments or grid/random sample (e.g. 6-12 candidates) to validate the loop; use a small NSGA-II population and limited generations only after the loop is stable. Cache evaluations using a hash of geometry, materials, loads, supports, solver settings and mesh settings.

Do not train a surrogate model in the 24-hour MVP unless a reliable labeled simulation dataset already exists. A later surrogate can accelerate exploration but must be evaluated against unseen solver runs.

---

# 4. Engineering data, units and simulation contracts

## 4.1 Units policy

Use an explicit unit system at all boundaries. Recommended canonical analysis units:

- Length: metre (m) internally; display mm in the UI where useful.
- Force: newton (N).
- Stress/modulus: pascal (Pa); display MPa/GPa.
- Mass: kilogram (kg).
- Density: kg/m³.
- Temperature: kelvin (K) internally; display °C where appropriate.
- Thermal conductivity: W/(m/K).
- Heat flux: W/m².
- Displacement: metre internally; display mm.

STEP files may encode or imply units differently. The importer must detect/read the unit metadata where possible, require confirmation when ambiguous, convert to canonical units and store the source unit. Never assume every STEP file is in millimetres without checking.

Every numeric engineering field must carry a unit or be part of a typed schema with a fixed unit. Never exchange bare unlabelled numbers between services.

## 4.2 Required engineering input schema

Each simulation request must contain:

- `component_type`
- `design_id` and `geometry_version`
- `analysis_type`
- `unit_system`
- `material_id` and material-property snapshot
- `design_variables` and bounds
- `load_cases`
- `boundary_conditions`
- `objectives`
- `constraints`
- `mesh_settings`
- `solver_settings`
- `assumptions` and their source/status
- `requested_candidate_budget` where relevant

The API must reject incomplete requests. If required values are missing, return a structured validation response identifying missing fields. Do not let the AI guess them.

## 4.3 Material data

Keep material properties in a controlled JSON/DB catalog. Every record should include:

- Material ID and human-readable grade/name.
- Density.
- Elastic modulus and Poisson's ratio for structural profiles.
- Yield strength where a stress margin is calculated.
- Thermal conductivity and heat capacity for thermal profile when required.
- Temperature dependency if known and needed.
- Units.
- Source URL/document or `demo_assumption` label.
- Record version and last reviewed timestamp.

If the team uses illustrative demo material values, label them clearly as illustrative and not suitable for manufacturing decisions.

## 4.4 Named geometry regions

Component templates must expose semantic regions rather than hard-coded arbitrary face indexes:

- `fixed_regions`
- `load_regions`
- `pressure_regions` where applicable
- `thermal_hot_regions`
- `thermal_cold_or_sink_regions`
- `non_design_regions`
- `interface_regions`

Region identifiers must remain stable after geometry regeneration. The CAD template or geometry-selection layer must assign these regions and test that each expected region contains faces/elements before the solver runs.

## 4.5 Simulation result contract

Store both summary metrics and field data.

**Summary metrics (where relevant):**

- `mass_kg`
- `max_von_mises_pa`
- `max_displacement_m`
- `compliance_j` or a clearly named strain-energy metric
- `min_yield_margin` / `factor_of_safety` only when its definition and material yield strength are available
- `max_temperature_k`
- `min_temperature_k`
- `max_temperature_gradient_k_per_m` where calculated
- `heat_flow_w` where calculated
- `constraint_results[]`
- `is_feasible`
- `solver_name`, `solver_version`, `mesh_metadata`, `warnings[]`

**Visualization fields:**

- Node coordinates.
- Element connectivity.
- Displacement vectors for structural runs.
- Scalar stress values at nodes or elements, with location clearly identified.
- Temperature field for thermal runs.
- Simulation step/load factor or thermal result state.
- Mapping from result nodes to rendered mesh vertices.

The visualization layer must know whether a scalar is nodal or elemental and must not present it as a different quantity.

## 4.6 Validation benchmarks

Before showing automotive results, verify each solver path using a simple benchmark with a known/analytical or trusted reference solution:

- Structural: cantilever beam or another standard linear-elastic benchmark.
- Thermal: one-dimensional steady-state conduction benchmark.
- Geometry: valid solids with positive volume and expected dimensions.
- Optimization: a known toy optimization problem or a hand-checkable parameter sweep.

Add a mesh-refinement check to at least the flagship structural case. If results change materially as the mesh is refined, report that the result is not mesh-converged rather than hiding it.

---

# 5. Technical architecture and selected stack

## 5.1 Recommended stack

| Layer | Selected technology | Responsibility |
|---|---|---|
| Frontend | React + TypeScript + Vite | Engineering workspace and controls |
| 3D visualization | Three.js + React Three Fiber + Drei | CAD display, result fields, geometry transitions and playback |
| Client state | Zustand | Project, job, candidate and viewer state |
| API | Python + FastAPI + Pydantic | Request validation, orchestration and result delivery |
| CAD generation | CadQuery + OpenCascade/OCP | Parametric geometry and STEP export |
| Meshing | Gmsh Python API | Tetrahedral mesh and physical groups |
| Structural solver | CalculiX | Linear static structural analysis for wheel/caliper MVP |
| Thermal solver | Elmer if available and verified; otherwise a clearly labelled reduced-order thermal model for the hackathon fallback | Spark-plug heat-transfer profile |
| Optimization | SciPy for simple parameter search; pymoo/NSGA-II for multi-objective candidate exploration | Candidate selection and trade-off search |
| Geometry utilities | Trimesh, NumPy | Mesh inspection, conversion and geometry metrics |
| Persistence | SQLite + local artifact storage | Projects, jobs, candidates, metrics and files |
| Testing | pytest + frontend test/build checks | Engineering, API and UI validation |
| Version control | Git | Team collaboration and phase tracking |

### Important implementation choices

- Use **CadQuery** for parameterized geometry generation and STEP output. FreeCAD may be used as a desktop inspection/validation tool; do not make the backend dependent on FreeCAD's embedded Python unless there is a demonstrated need.
- Use **Gmsh** to generate the mesh and named physical groups. Keep CAD geometry and FEA mesh separate from the browser visualization mesh.
- Use **CalculiX** for the structural MVP. It accepts an Abaqus-like `.inp` workflow and can be invoked as a command-line process.
- Use **Elmer** for a robust thermal solver path if it can be installed and verified in the available environment. FreeCAD's FEM documentation identifies Elmer as a strong option for thermal/multiphysics and CalculiX as the main choice for mechanical/thermomechanical analysis. If Elmer cannot be made reliable in the hackathon, use a reduced-order thermal conduction calculation and label it as such. Do not imply it is 3D FEA.
- Use **pymoo NSGA-II** only after the candidate-evaluation loop is working. It is an optimization framework, not a CAD generator or a physics solver.
- Use **GLB/glTF** for browser delivery of component geometry. Use custom mesh/result payloads or VTK-derived data for stress/displacement/temperature fields; GLB alone is not the authoritative FEA result store.
- Pin dependency versions after a successful clean installation and commit the lock files.

## 5.2 Frontend architecture

Suggested directories:

```text
frontend/
  src/
    app/
    components/
      layout/
      viewer/
      charts/
      forms/
    features/
      projects/
      components/
      requirements/
      simulations/
      generation/
      comparison/
      reports/
    services/
      api.ts
    store/
      projectStore.ts
      jobStore.ts
      viewerStore.ts
    types/
    utils/
```

Required viewer capabilities:

- Load GLB geometry.
- Orbit, pan, zoom, reset camera and fit-to-model.
- Toggle wireframe/solid/mesh/load-support overlays.
- Apply vertex colours for stress or temperature.
- Display loads and supports as clearly labelled arrows/markers.
- Animate displacement fields with an explicit deformation scale factor.
- Animate geometry variants. Use true vertex morphing only if vertex correspondence/topology is compatible; otherwise cross-fade or staged replacement.
- Allow original and candidate comparison.
- Display actual units and numeric values on hover/selection.
- Show whether an animation is a computed result, a load-factor visualization or a transition between separate geometries.

## 5.3 Backend architecture

Suggested directories:

```text
backend/
  app/
    main.py
    core/
      config.py
      logging.py
      units.py
    api/
      routes/
        projects.py
        components.py
        designs.py
        jobs.py
        simulations.py
        exports.py
        assistant.py
    schemas/
      requirements.py
      component.py
      design.py
      simulation.py
      job.py
      result.py
    db/
      session.py
      models.py
      repositories.py
    services/
      job_manager.py
      artifact_store.py
      report_service.py
      cost_estimator.py
    engineering/
      cad/
        importer.py
        exporter.py
        geometry_validation.py
        generators/
          alloy_wheel.py
          brake_caliper.py
          spark_plug.py
      meshing/
        gmsh_runner.py
        region_mapping.py
      solvers/
        base.py
        calculix.py
        elmer.py
        reduced_thermal.py
        result_parser.py
      optimization/
        candidate.py
        objectives.py
        constraints.py
        search.py
        nsga2.py
      visualization/
        glb_export.py
        result_payload.py
      ai/
        requirement_parser.py
        result_explainer.py
    tests/
  storage/
```

Each component generator and solver profile must implement a documented interface. Avoid component-specific conditionals scattered throughout the codebase.

## 5.4 Engineering adapter interfaces

Define interfaces similar to:

```python
class ComponentGenerator:
    def validate_parameters(self, request): ...
    def generate(self, request, output_dir): ...
    def get_named_regions(self, geometry): ...
    def export_step(self, geometry, output_path): ...
    def export_preview_mesh(self, geometry, output_path): ...
    def calculate_mass_properties(self, geometry, material): ...

class SimulationAdapter:
    def validate_case(self, design, case): ...
    def create_mesh(self, design, mesh_settings, output_dir): ...
    def write_solver_input(self, design, mesh, case, output_dir): ...
    def run(self, input_path, timeout_seconds, output_dir): ...
    def parse_results(self, output_dir): ...

class OptimizerAdapter:
    def propose_candidates(self, problem_definition, budget): ...
    def receive_evaluation(self, candidate_id, objectives, constraints): ...
    def get_ranked_candidates(self): ...
```

The final code may use Python protocols, abstract base classes or typed services, but the separation must remain.

## 5.5 Background job handling

CAD generation, meshing and solvers are long-running tasks. Never run them directly inside a FastAPI request handler or block the event loop.

For the hackathon:

- Use a simple local job manager persisted in SQLite.
- Launch engineering tasks in worker threads/processes or subprocesses.
- Use `subprocess.run`/`Popen` with argument arrays, not shell-concatenated user input.
- Apply timeouts, capture stdout/stderr and store logs.
- Persist job status and progress stage.
- Expose status through polling (`GET /api/jobs/{job_id}`).
- Add SSE/WebSocket progress only if the basic polling flow is stable.
- Prevent duplicate jobs for the same request hash when feasible.
- Allow a failed job to show a clear error and preserve its artifacts/logs.

Job statuses:

`queued -> validating -> generating_geometry -> meshing -> solving -> optimizing -> packaging -> completed`

Terminal alternatives: `failed`, `cancelled`.

---

# 6. Dynamic animation and visualization requirements

Animation is a core product feature, not decorative polish. It must communicate engineering activity and design evolution while remaining honest about what was calculated.

## 6.1 Three animation modes

### A. Simulation-result animation

**Structural wheel/caliper:**

- Show the mesh or solid component.
- Display load arrows and supports.
- Show calculated stress contour colours.
- Animate a displacement field from zero to the calculated result.
- Include an explicit deformation scale (for example, `deformation scale = 10x` if exaggerated).
- Show actual maximum displacement numerically in real units.
- If the analysis is a linear static solve, a load-factor ramp is only a visualization of the static solution; label it as such. Do not call it transient/dynamic analysis.

**Spark plug:**

- Show temperature contours based on the thermal result.
- A colour ramp from ambient to the computed steady-state distribution can be used for visualization.
- Label it as `steady-state result visualization`, not as transient thermal simulation unless transient steps were actually solved.

### B. Geometry-transformation animation

- Show the baseline design.
- Highlight the region or parameter being changed.
- Display the candidate geometry generated by the CAD engine.
- Transition between baseline and candidate.
- If mesh topology is compatible, use morph targets/vertex interpolation.
- If topology differs, use a cross-fade or staged replacement; never invent a false one-to-one deformation.
- After transition, show the actual new CAD asset and its design-variable values.

### C. Generative exploration animation

- Show candidate variants as they are created.
- Display optimization generation and candidate ID.
- Show candidate status: pending, geometry valid, meshed, solved, feasible/infeasible, failed.
- Update the candidate table as evaluations complete.
- Show a progress timeline and allow playback of stored stages.

## 6.2 Result payload sent to frontend

The visualization API should provide:

- `geometry_asset_url` (GLB for the CAD/preview model).
- `mesh_nodes` and `mesh_elements` or a compact equivalent result mesh.
- `node_displacements` for structural runs.
- `stress_values` plus an explicit nodal/elemental location flag.
- `temperature_values` for thermal runs.
- `load_steps` or `result_states` only when available.
- `summary_metrics` with units.
- `visualization_scale` and an explanation of any exaggeration.
- `result_kind` (e.g. `linear_static`, `steady_state_thermal`, `reduced_order_thermal`).

Do not transfer large files as enormous JSON arrays if a binary file or compressed artifact is more efficient. The MVP may begin with JSON for small test models and add binary payloads when required.

## 6.3 Visual design requirements

- Professional engineering workspace, not a generic chatbot landing page.
- Keep the 3D model as the dominant visual element.
- Use consistent colour scales with a visible legend and min/max values.
- Avoid using red/green as the only distinction; include numeric labels and text status.
- Show `FEA result`, `estimated`, `demo assumption` or `not validated` labels where appropriate.
- Provide camera reset, fit, orbit and zoom.
- Preserve a before/after comparison view.

---

# 7. AI assistant: role, input contract and guardrails

## 7.1 What the AI assistant does

- Interpret an engineer's natural-language objective.
- Identify which component profile and analysis type are relevant.
- Convert the request into a structured draft specification.
- Identify missing engineering inputs and ask for them.
- Explain calculated results using stored solver outputs.
- Summarize trade-offs among feasible candidates.
- Draft an engineering report with assumptions and provenance.

## 7.2 What the AI assistant must never do

- Invent material properties, loads, supports or safety limits.
- Claim a simulation passed if no solver completed.
- Make up stress, displacement, temperature or mass figures.
- Treat an LLM-generated shape as a validated CAD solid.
- silently fill missing engineering fields with guesses.
- Claim automotive certification or production readiness.
- Override engineer-confirmed requirements without asking.

## 7.3 Structured requirement output

The LLM should return a validated object containing:

```json
{
  "component_type": "alloy_wheel | brake_caliper | spark_plug",
  "design_mode": "improve_existing | generate_new",
  "analysis_type": "linear_static_structural | steady_state_thermal | reduced_order_thermal",
  "objective_summary": "string",
  "design_variables": {},
  "materials": [],
  "load_cases": [],
  "boundary_conditions": [],
  "objectives": [],
  "constraints": [],
  "manufacturing_constraints": [],
  "units": {},
  "missing_fields": [],
  "assumptions_requiring_confirmation": [],
  "warnings": []
}
```

The schema above is a conceptual contract; implement proper Pydantic models and enums. Do not accept arbitrary LLM JSON without validation. If `missing_fields` is non-empty, block simulation until the required values are supplied or an explicitly labelled demo fixture is selected.

## 7.4 Offline/fallback mode

The project must still work if no LLM API key is configured. Provide structured forms and deterministic result summaries. The LLM is an enhancement, not a dependency for generating geometry or running physics.

---

# 8. API design and data persistence

## 8.1 Suggested API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| POST | `/api/components/import` | Upload/validate CAD asset |
| GET | `/api/components/{component_id}` | Get component profile and asset |
| POST | `/api/designs/generate` | Create new design candidate job |
| POST | `/api/designs/{design_id}/optimize` | Start optimization job |
| POST | `/api/simulations/run` | Start a simulation |
| GET | `/api/jobs/{job_id}` | Read status/progress/log summary |
| GET | `/api/designs/{design_id}/variants` | List design candidates |
| GET | `/api/designs/{design_id}/results` | Read simulation summaries/fields |
| GET | `/api/assets/{asset_id}` | Download/view an artifact |
| GET | `/api/designs/{design_id}/export?format=step` | Export CAD |
| POST | `/api/assistant/interpret` | Parse natural-language requirements |
| POST | `/api/reports/generate` | Generate comparison report |

## 8.2 Core database entities

- `Project`: name, description, created time.
- `ComponentInstance`: component type, project ID, source mode, units, original asset.
- `DesignVersion`: baseline/candidate, parent design, geometry asset, parameters, material snapshot, geometry hash.
- `EngineeringSpecification`: objectives, constraints, materials, loads, supports, assumptions and sources.
- `SimulationRun`: design version, analysis type, solver, solver version, mesh settings, status and timestamps.
- `SimulationResult`: summary metrics, feasibility, warnings and result asset paths.
- `OptimizationRun`: algorithm, seed, budget, generations, objective definitions and termination reason.
- `Candidate`: parameters, geometry hash, associated simulation, objective values, constraint violations and rank.
- `Job`: type, stage, progress, status, log path, error and timestamps.
- `Artifact`: file type, relative path, checksum, size, units and parent entity.

SQLite is adequate for the hackathon. Store CAD, mesh, solver and visualization files on disk/object storage, not as large database blobs.

## 8.3 Artifact folder convention

```text
storage/
  projects/
    <project_id>/
      <component_instance_id>/
        source/
          original.step
          source_metadata.json
        designs/
          <design_id>/
            design.step
            preview.glb
            parameters.json
            geometry_validation.json
        simulations/
          <run_id>/
            mesh.msh
            solver.inp
            solver.log
            results.frd
            results.dat
            summary.json
            visualization_payload.*
        reports/
          comparison_report.pdf
          comparison_report.json
```

Use safe generated IDs for path segments. Never use raw user-uploaded filenames as filesystem paths. Calculate checksums so cached geometry/simulation results can be identified.

## 8.4 Reproducibility metadata

Every candidate/result must record:

- Source design/version.
- Generator name/version and parameter set.
- Material-property snapshot and source.
- Load/support/thermal boundary conditions.
- Unit conversions.
- Mesh settings and mesh statistics.
- Solver name/version/settings.
- Optimization algorithm, seed and budget.
- Warnings, errors and run log path.

---

# 9. Prototype cost and time estimator

The business objective is to estimate the value of reducing early physical prototype cycles. The estimator is not a proof of savings; it is a transparent scenario calculator.

## 9.1 Inputs

- Cost per physical prototype (material + machining/fabrication + assembly, as applicable).
- Physical test cost per iteration.
- Engineering labour hours and hourly cost.
- Number of expected traditional physical iterations.
- Number of physical prototypes expected after virtual screening.
- Virtual simulation/compute cost per run or per project.
- Engineering time required for virtual setup/review.

## 9.2 Calculations

`traditional_cost = physical_iterations x (prototype_cost + physical_test_cost) + traditional_engineering_cost`

`virtual_first_cost = virtual_run_cost + virtual_engineering_cost + selected_physical_iterations x (prototype_cost + physical_test_cost)`

`estimated_savings = traditional_cost - virtual_first_cost`

`estimated_savings_percent = estimated_savings / traditional_cost x 100` (only when traditional_cost > 0)

Show all assumptions and inputs. Never present an illustrative estimate as a measured factory saving. Do not hardcode claims such as “30% cheaper” or “50% faster” without measured evidence.

---

# 10. Installation and local development setup

## 10.1 Recommended development environment

Target Windows 10/11 for the team UI and development tools. Use Python 3.12 for the backend/CAD environment. If native Windows solver installation becomes unreliable, run the engineering solver in the team's Ubuntu VM/WSL environment and keep the same FastAPI adapter contract. Do not mix FreeCAD's embedded Python packages into the project's virtual environment.

## 10.2 Required applications

1. Visual Studio Code.
2. Python 3.12.
3. Node.js LTS and npm.
4. Git.
5. FreeCAD stable Windows release (for CAD inspection and FEM workflow verification).
6. Gmsh (Python SDK/package and, optionally, standalone GUI).
7. CalculiX solver executable for structural analysis.
8. Elmer only if the team chooses the preferred thermal solver and can verify the install during preflight.

## 10.3 Backend setup (Windows PowerShell)

```powershell
mkdir AutoTwin
cd AutoTwin
mkdir backend, frontend, storage, docs
cd backend

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip

pip install fastapi "uvicorn[standard]" python-multipart pydantic pydantic-settings sqlalchemy alembic python-dotenv
pip install numpy scipy pandas trimesh meshio
pip install cadquery gmsh pymoo
pip install pytest httpx
```

If CadQuery's binary dependencies fail in the environment, use its documented Conda/Miniforge installation route rather than randomly changing OpenCascade versions. After a working install, freeze/pin dependencies in `requirements.txt` or a lock file.

## 10.4 Verify backend imports

```powershell
python -c "import fastapi, numpy, scipy, trimesh, cadquery, gmsh, pymoo; print('core imports OK')"
```

If this fails, fix the environment before writing application code.

## 10.5 Solver preflight

- Locate the CalculiX executable (`ccx`/`CalculiX.exe`).
- Configure its absolute path in `.env` as `CALCULIX_BIN`.
- Run a minimal benchmark input and confirm a successful exit code and expected output files.
- Verify Gmsh can import a simple geometry and write a valid 3D mesh.
- If running FreeCAD FEM manually, run its included cantilever example to confirm the mesher and solver are correctly discovered.
- For spark-plug thermal analysis, run a known 1D steady-state conduction benchmark using the selected thermal solver before enabling 3D thermal results.

Example `.env`:

```dotenv
APP_ENV=development
DATABASE_URL=sqlite:///./autotwin.db
STORAGE_ROOT=../storage
CALCULIX_BIN=C:/path/to/ccx.exe
GMSH_BIN=C:/path/to/gmsh.exe
ELMER_BIN=
LLM_API_KEY=
LLM_MODEL=
```

Paths must be adapted to the actual machine. Never commit API keys or secrets.

## 10.6 Frontend setup

From the project root:

```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install three @types/three @react-three/fiber@^9 @react-three/drei zustand axios lucide-react
```

Use React 19 with React Three Fiber v9, or keep compatible versions together. Do not mix Fiber v8 with React 19. Commit `package-lock.json`.

## 10.7 FreeCAD and solver note

FreeCAD's FEM documentation describes a workflow of geometry, material, mesh, loads/supports, solver run and post-processing. It documents CalculiX for structural/thermomechanical work and Elmer for thermal/multiphysics work; the Windows FreeCAD distribution includes CalculiX in the documented workflow. The coding agent should verify the actual installed binary path instead of assuming it.

---

# 11. Phase-by-phase implementation plan

Every phase ends with a gate. The agent must update `BUILD_TRACKER.md` with status, commit hash (if using Git), test evidence and blockers.

## Phase 0 - Environment and engineering preflight (Hour 0-2)

**Tasks**

- Create repository and virtual environments.
- Install and verify Python/Node/CAD libraries.
- Verify Gmsh and CalculiX execution.
- Select one test geometry per component or create simplified templates.
- Confirm unit system and example materials.
- Run a structural benchmark and a thermal benchmark.

**Acceptance gate**

- All required imports pass.
- Frontend runs locally.
- FastAPI health endpoint responds.
- Gmsh creates a valid mesh.
- At least one structural solver benchmark completes.
- Thermal solver/fallback path is selected and benchmarked.

**If blocked**

Do not proceed to the full UI. Fix the solver/toolchain or switch to the documented fallback. Record exactly what is not supported.

## Phase 1 - Project foundation and contracts (Hour 2-4)

**Tasks**

- Create backend and frontend folder structures.
- Create Pydantic schemas for project, design request, simulation request, job, candidate and result.
- Create SQLite models and artifact-store abstraction.
- Create FastAPI health and project endpoints.
- Create frontend shell with routes/screens and a placeholder 3D viewer.
- Create component profile registry.

**Acceptance gate**

- Project can be created and listed.
- Component profiles are selectable.
- API schemas reject missing required fields.
- Job record persists and status can be read.

## Phase 2 - CAD and geometry generation (Hour 4-7)

**Tasks**

- Implement STEP import and geometry validation.
- Implement preview mesh generation and GLB export.
- Implement parameterized CAD generator for alloy wheel.
- Implement parameterized CAD generator for brake caliper.
- Implement parameterized CAD generator for spark plug.
- Preserve interface/non-design regions and expose named region metadata.
- Validate solid count, volume, bounding box, clearances and parameter bounds.

**Acceptance gate**

- Each component profile can generate at least one valid STEP model from a parameter set.
- Each model has a preview asset loaded in the browser.
- Invalid parameter sets are rejected with clear messages.
- Required interface regions are present.

**Scope fallback**

If generating three full templates is too slow, use curated, pre-validated component templates and expose a small set of safe parameters for each. Do not label an STL-only asset as editable parametric CAD.

## Phase 3 - Meshing and physics adapters (Hour 7-11)

**Tasks**

- Build Gmsh runner and mesh validation.
- Implement named physical groups for loads/supports/thermal boundaries.
- Implement CalculiX input deck generation for the structural profiles.
- Implement solver process runner, timeouts and logs.
- Implement result parser and normalized result contract.
- Implement spark-plug steady-state thermal adapter or reduced-order fallback.
- Add structural and thermal benchmark tests.

**Acceptance gate**

- At least one alloy-wheel structural candidate completes an actual solver run.
- At least one brake-caliper structural candidate completes a run, or its limitation is explicitly recorded with a working template/profile and no fake results.
- Spark-plug profile returns a valid result from the verified selected method and labels the method correctly.
- Result fields and summary values are traceable to solver output or an identified analytical model.

## Phase 4 - Generative candidate loop and optimization (Hour 11-15)

**Tasks**

- Define parameter bounds for each component.
- Create deterministic initial candidate sampling.
- Build candidate generation and geometry validation pipeline.
- Connect solver evaluation to optimizer.
- Add objective/constraint evaluation.
- Add candidate cache/hash and status tracking.
- Add small NSGA-II run for a multi-objective case if solver runtime permits.
- Persist all candidate parameters, metrics, failures and artifacts.

**Acceptance gate**

- The platform generates multiple different geometries from requirements.
- Each candidate can be evaluated or marked failed with a reason.
- At least one candidate is compared against a baseline using actual calculated values.
- Feasibility status is derived from explicit constraints.
- Results are reproducible from saved inputs.

## Phase 5 - 3D visualization and dynamic animation (Hour 14-18)

**Tasks**

- Load GLB/mesh assets in Three.js.
- Add orbit/pan/zoom/reset/fit controls.
- Add stress/temperature colour maps and legends.
- Add load/support overlays.
- Animate structural displacement using actual result vectors and a labelled scale factor.
- Add steady-state thermal visualization for the spark plug.
- Add baseline-to-candidate transition (morph only for compatible topology; otherwise cross-fade).
- Add generation timeline and candidate status updates.

**Acceptance gate**

- Baseline and generated geometry are visibly different when parameters differ.
- Stress/temperature colours are connected to actual field data.
- Numeric summary values and units are visible.
- Animation clearly distinguishes computed result, visualization ramp and geometry transition.

## Phase 6 - AI assistant, explanation and cost model (Hour 17-20)

**Tasks**

- Add optional LLM provider adapter.
- Parse user objective into strict structured requirements.
- Ask for missing inputs and require confirmation.
- Generate explanations from stored results only.
- Add comparison report generation.
- Add cost/time scenario calculator with user inputs and assumptions.

**Acceptance gate**

- AI output passes Pydantic validation.
- Missing engineering fields block solver execution.
- AI explanations cite stored measured/computed values and do not invent data.
- Application works in non-LLM mode.
- Cost report labels estimates and assumptions.

## Phase 7 - End-to-end integration and validation (Hour 20-22)

**Tasks**

- Run the full workflow from user request to exported candidate.
- Test all three component profiles.
- Test failed geometry, failed solver, missing fields and timeout handling.
- Check file naming, storage paths and project isolation.
- Check candidate comparison and report consistency.
- Confirm that displayed numbers match stored result JSON.

**Acceptance gate**

- No critical end-to-end blocker for the primary demo.
- Every displayed result has a source and unit.
- Failed jobs show useful status/log information.
- Exported STEP reopens in a CAD application.

## Phase 8 - Demo preparation and freeze (Hour 22-24)

**Tasks**

- Freeze features.
- Prepare one known-good design scenario per component.
- Rehearse one complete primary workflow.
- Prepare a short backup screen recording or stored run only as backup; label stored/precomputed data honestly.
- Prepare a one-slide architecture and limitations summary.
- Capture final screenshots and metrics.

**Acceptance gate**

- Primary workflow is repeatable.
- No live feature is dependent on a network service unless tested.
- All demo values are either computed live or clearly marked as stored/illustrative.
- Team can explain assumptions and limits.

---

# 12. 24-hour timeline and team responsibilities

## 12.1 Suggested four-member team split

| Role | Ownership | Required handoff |
|---|---|---|
| Member A - CAD/generation | CadQuery templates, geometry validation, STEP/GLB output | Generator interface and named regions |
| Member B - simulation/optimization | Gmsh, CalculiX/thermal solver, result parser, objective/constraint logic | Solver adapter and validated result contract |
| Member C - frontend/visualization | React workspace, Three.js viewer, animation, candidate comparison | Viewer props and result payload contract |
| Member D - backend/integration/AI | FastAPI, SQLite, job manager, AI parsing, reports, cost estimator | Stable APIs and end-to-end integration |

If team size differs, preserve the same ownership boundaries; combine roles but do not let every person edit the same core module.

## 12.2 Timeline

| Time | Primary goal | Exit evidence |
|---|---|---|
| 0-2 h | Preflight | Imports + solver benchmark + app boots |
| 2-4 h | Foundation | API schemas, DB, project shell |
| 4-7 h | CAD generation | Three profile assets, at least one generated per profile |
| 7-11 h | Simulation | Actual structural run + verified thermal path |
| 11-15 h | Generative loop | Candidate set, evaluation and comparison |
| 14-18 h | Visualization | Dynamic result and geometry transition |
| 17-20 h | AI/reporting | Strict parsing, grounded explanation, cost estimate |
| 20-22 h | Integration | End-to-end run and error handling |
| 22-24 h | Demo freeze | Rehearsed workflow and pitch |

Some phases overlap by team role, but integration gates must be respected. A feature is not complete just because one branch contains code; it must work with the shared contracts.

---

# 13. Testing strategy and definition of done

## 13.1 Geometry tests

- Generated CAD file exists and is non-empty.
- Solid is valid and has positive volume.
- Bounding box and key dimensions match requested limits.
- Protected interfaces remain unchanged within configured tolerance.
- No self-intersections/invalid geometry according to available geometry checks.
- STEP export reopens in a compatible CAD viewer.

## 13.2 Simulation tests

- Solver command exits successfully.
- Solver output is not empty and contains expected result records.
- Material, load, supports and mesh settings are recorded.
- Benchmark test is within a documented tolerance against reference/analytical output.
- Mesh metadata is stored.
- Result parser rejects incomplete/corrupt output.
- Stress/temperature field mapping is verified against the result mesh.

## 13.3 Optimization tests

- Candidate variables stay within bounds.
- Invalid candidates are rejected.
- Objective functions use computed metrics, not invented scores.
- Constraint pass/fail is deterministic.
- Candidate cache key includes geometry, material, loads, supports, mesh and solver settings.
- Optimizer does not rank an unevaluated design as the best feasible design.

## 13.4 API/frontend tests

- API health endpoint works.
- Project creation/listing works.
- Upload validation catches unsupported files/oversized inputs.
- Job status survives page refresh.
- Candidate comparison displays correct values and units.
- 3D viewer handles missing assets and failed jobs gracefully.
- No untrusted file path or shell injection path is accepted.

## 13.5 Definition of done for a candidate

A candidate can be labelled **Simulation Evaluated** only if:

1. Geometry generation/import succeeded.
2. Geometry validation succeeded.
3. Mesh creation succeeded where FEA is required.
4. Solver completed successfully or the documented reduced-order model completed.
5. Result parsing succeeded.
6. Metrics and units were saved.
7. Constraints were evaluated.
8. The method and assumptions are visible.

A candidate can be labelled **Feasible under configured model** only if all configured constraints pass. This status is not the same as certified, safe for road use or approved for manufacturing.

---

# 14. Risk register and fallback decisions

- **CalculiX binary not found:** structural solver cannot run. Preflight immediately; locate the FreeCAD-bundled binary or use the documented Ubuntu environment.
- **Gmsh/mesh region mapping fails:** loads/supports cannot be applied reliably. Use simpler template geometry and semantic region selectors; test physical groups before a solver run.
- **Arbitrary STEP cannot be edited:** no generative modification path. Use a curated parameterized template; allow arbitrary STEP only for viewing/analysis unless editable feature mapping exists.
- **Three solver pipelines exceed the time budget:** complete one end-to-end structural pipeline first; use a clearly labelled reduced-order thermal profile only if its equations and assumptions are verified.
- **Solver result parsing is difficult:** implement a tested adapter for a small benchmark; expose summary metrics only when fields cannot be parsed; never fake heatmaps.
- **Optimization runs too slowly:** reduce mesh size, candidate budget and generations; cache repeated evaluations; use a deterministic parameter sweep as fallback.
- **AI API is unavailable:** keep structured forms and a deterministic explanation path.
- **Geometry morph is incompatible:** cross-fade separate model assets; do not use invalid vertex correspondence.
- **Inputs are incomplete:** ask for missing information; reject the simulation until mandatory inputs are supplied or a clearly labelled demo fixture is selected.
- **Cost/safety claims could mislead:** expose assumptions, label cost outputs as estimates, and require engineering review and physical validation.

---

# 15. Demo storyline for judges

The primary demonstration should be a single complete workflow, preferably the alloy wheel because it provides the clearest visual generative-design story.

1. Explain the problem: repeated physical design iterations consume time, labour, material and test budget.
2. Select **Generate New Design** or **Improve Existing Design**.
3. Enter an objective, protected interfaces, material, load case and limits.
4. Show the design envelope and initial geometry.
5. Start candidate generation; show candidate IDs and progress.
6. Show one candidate under actual calculated stress/displacement results.
7. Show a generated alternative and replay the geometry transition.
8. Compare baseline and candidate using real computed mass/stress/displacement metrics.
9. Explain which constraints pass and which do not.
10. Export the selected STEP model and a traceable engineering report.
11. Briefly switch to Brake Caliper and Spark Plug to demonstrate component-specific profiles and different physics workflows.
12. Close with the estimated cost/time scenario, clearly labelled with its inputs and assumptions.

Do not spend the main demo switching between many screens. The judge should see one design move through the full loop: **requirements -> geometry -> simulation -> generation -> re-simulation -> comparison -> export**.

## 15.1 Metrics to show

- Number of candidates generated.
- Number of candidates successfully simulated.
- Number of candidates feasible under configured constraints.
- Baseline vs selected-candidate mass.
- Baseline vs selected-candidate stress/displacement or thermal metrics.
- Time for one solver run and complete candidate loop.
- Estimated cost scenario and its assumptions.

Report only measured values from the run. If the data is a stored demo run, label it as a stored demonstration. If a value comes from an illustrative fixture, label it as illustrative.

---

# 16. Explicit instructions for the IDE coding agent

The coding agent must follow these rules throughout development:

1. Read this entire specification before editing the repository.
2. Inspect the existing files and environment before scaffolding a new app. Do not overwrite existing user work without checking it.
3. Implement one phase at a time and update `BUILD_TRACKER.md` after each phase.
4. Keep frontend, API, CAD generation, meshing, solvers, optimization and AI in separate modules.
5. Use typed Pydantic schemas at the API boundary and typed TypeScript interfaces in the frontend.
6. Treat all units explicitly and convert at service boundaries.
7. Do not run solvers inside FastAPI's event loop.
8. Do not use `shell=True` with user-controlled strings.
9. Never fake FEA results, mesh data, stress maps, temperature fields or candidate pass/fail statuses.
10. If a solver is unavailable, implement a clearly labelled fallback and document what it does not prove.
11. Never allow an LLM to invent material values, loads or boundary conditions. Require confirmation for missing or ambiguous inputs.
12. Every generated candidate must be reproducible from stored parameters, source version, material snapshot and solver configuration.
13. Preserve mounting/assembly interfaces and non-design regions for each component.
14. Use the same stable component profile interface for all three parts.
15. Do not introduce Redis, Celery, Docker, Kubernetes, PostgreSQL or microservices unless a real blocker justifies them. The 24-hour build should remain locally runnable.
16. Commit dependency lock files and document the exact startup commands.
17. Add tests for every engineering adapter before connecting it to the live UI.
18. Keep a visible warning that virtual results are not regulatory certification or a substitute for required physical validation.
19. Prefer a complete, validated workflow over extra screens or decorative features.
20. Before declaring completion, run backend tests, frontend build, benchmark tests and the full demo workflow.

## 16.1 First tasks the agent should perform

1. Inspect repository and installed software.
2. Create `BUILD_TRACKER.md` from the template below.
3. Run environment preflight and document solver paths.
4. Create one structural benchmark and one thermal benchmark.
5. Create FastAPI health endpoint and Vite frontend shell.
6. Implement the alloy-wheel CAD-to-simulation vertical slice before adding advanced features.

---

# 17. Project tracking template

Create and maintain a repository-root file named `BUILD_TRACKER.md`. Use it as the live progress record. Update it after every phase, not only at the end.

For each task use one status:

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `DONE`

A task is `DONE` only when its acceptance criteria pass and test evidence is recorded.

## 17.1 Milestone checklist

- [ ] M0 - Environment preflight complete.
- [ ] M1 - Backend/frontend foundation complete.
- [ ] M2 - Component profiles and CAD generation complete.
- [ ] M3 - Meshing and solver benchmark complete.
- [ ] M4 - Candidate generation and optimization complete.
- [ ] M5 - Dynamic 3D simulation and geometry animations complete.
- [ ] M6 - AI requirement parsing and result explanation complete.
- [ ] M7 - Cost estimator and report complete.
- [ ] M8 - Full end-to-end validation complete.
- [ ] M9 - Demo rehearsal and feature freeze complete.

## 17.2 Phase log format

For every phase, record:

```text
Phase:
Owner:
Status:
Started:
Completed:
Files changed:
Commands/tests run:
Acceptance criteria passed:
Evidence/artifact paths:
Known issues:
Next action:
Git commit:
```

## 17.3 Blocker log

Every blocker should have:

- Date/time.
- Module.
- Exact error or failure.
- Steps to reproduce.
- What has been tried.
- Chosen fallback.
- Owner.

Do not spend more than the agreed timebox on a low-priority blocker while the primary vertical slice is incomplete.

---

# 18. Future roadmap after the hackathon

These are future directions, not 24-hour commitments:

- True topology optimization and organic freeform geometry for more than one component.
- Better CAD feature recognition for arbitrary STEP uploads.
- More complex load cases and contact modelling.
- Wheel fatigue/impact, brake thermal/contact/fatigue and spark-plug combustion/ignition/electrical models where justified.
- Surrogate models trained on verified simulation datasets to accelerate exploration.
- Physical prototype test-data import for calibration and model updating.
- Manufacturing-aware constraints for casting, forging, machining and additive manufacturing.
- Design review approval, versioning and audit trail.
- Multi-user projects and cloud compute.
- Interoperability with PLM/CAE systems.

---

# 19. References and implementation documentation

Use official documentation and pin the versions that are actually verified in the development environment.

1. **CadQuery installation documentation** - supported installation routes including pip on Windows/Linux/macOS; recommends a virtual environment and notes that Conda is the more mature/tested path for some environments.  
   https://cadquery.readthedocs.io/en/latest/installation.html
2. **Gmsh official site and reference manual** - finite-element mesh generation and Python SDK.  
   https://gmsh.info/  
   https://gmsh.info/doc/texinfo/
3. **FreeCAD FEM Workbench documentation** - workflow for geometry, material, loads, supports, meshing, solver execution and post-processing.  
   https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/FEM_Workbench.md
4. **FreeCAD FEM installation and CalculiX documentation** - solver/mesher setup and CalculiX integration.  
   https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/FEM_Install.md  
   https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/FEM_CalculiX.md
5. **FreeCAD getting started with FEM** - overview of CalculiX and Elmer use cases.  
   https://freecad.github.io/Website/news/getting-started-with-fem/
6. **pymoo documentation** - multi-objective optimization, NSGA-II and optimization workflows.  
   https://pymoo.org/  
   https://pymoo.org/algorithms/moo/nsga2.html
7. **React Three Fiber documentation** - React renderer for Three.js and major-version compatibility.  
   https://r3f.docs.pmnd.rs/getting-started/introduction
8. **Three.js GLTFLoader documentation** - loading glTF/GLB assets in Three.js.  
   https://threejs.org/docs/pages/GLTFLoader.html
9. **Three.js BufferGeometry documentation** - vertex, index, colour and custom geometry attributes for result visualization.  
   https://threejs.org/docs/pages/BufferGeometry.html
10. **Three.js GLTFExporter documentation** - exporting glTF/GLB assets.  
    https://threejs.org/docs/pages/GLTFExporter.html

---

# 20. Final definition of the hackathon deliverable

The hackathon deliverable is a locally runnable web application that demonstrates a shared generative virtual-prototyping platform for:

- Alloy Wheel - structural virtual testing and generative structural design exploration.
- Brake Caliper - simplified structural virtual testing and design exploration.
- Spark Plug - steady-state thermal design exploration through a verified thermal solver or clearly labelled reduced-order model.

It must support existing-design improvement and requirements-first generation through parameterized component templates; create and simulate multiple candidates; rank them against explicit constraints and objectives; animate real geometry/result changes in 3D; compare candidates; and export the selected CAD model with its assumptions and results. **Success means a trustworthy, repeatable engineering loop - not a collection of AI buzzwords or dashboard screens.**
