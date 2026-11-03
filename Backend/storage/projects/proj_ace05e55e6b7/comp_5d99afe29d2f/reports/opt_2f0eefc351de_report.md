# Spark Plug generative design study - assurance live check

**Generated:** 2026-11-03T11:16:42.093644+00:00  
**Study:** `opt_2f0eefc351de`  
**Component:** Spark Plug (firing-end study)  
**Algorithm:** seeded Latin-hypercube design of experiments  
**Random seed:** 20261102

> This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.

## Outcome

**4 design(s) generated, 3 evaluated by the solver, 3 feasible under the configured constraints, 1 failed to evaluate.**

The design space was searched with seeded Latin-hypercube design of experiments. Every candidate was built by the parametric CAD generator, meshed, and solved with the same solver configuration before being judged, so the comparison between them is like-for-like.

Candidate 3 is the best feasible generated design, but it does not beat the baseline on peak temperature gradient (82.28 K/mm to 92.37 K/mm). Every candidate that reached a lower value violated a constraint. The baseline remains the best feasible design in the space searched so far.

Recommended design against the baseline: mass 0.02661 to 0.02705 kg (+1.7%); peak temperature 731.3 to 751.2 C (+2.0%); minimum temperature 413.8 to 410.8 C (-0.4%); peak temperature gradient 82.28 to 92.37 K/mm (+12.3%); heat flow through the sink surfaces 92.83 to 93.08 W (+0.3%).

Candidates that produced no result: 1 at the parameter_validation stage. They carry no metrics and are excluded from ranking.

## Baseline versus recommended design

| Metric | Baseline | Recommended | Change |
|---|---|---|---|
| mass_kg | 0.02661 kg | 0.02705 kg | +1.7% |
| max_temperature_k | 731.3 C | 751.2 C | +2.0% |
| min_temperature_k | 413.8 C | 410.8 C | -0.4% |
| max_temperature_gradient_k_per_m | 82.28 K/mm | 92.37 K/mm | +12.3% |
| heat_flow_w | 92.83 W | 93.08 W | +0.3% |

## All candidates

Every generated design is listed, including those that produced no result.

| # | Status | Feasible | Mass | Peak stress | Peak displacement | Rank | Note |
|---|---|---|---|---|---|---|---|
| Baseline | feasible | yes | 0.02661 kg | - | - | 1 |  |
| Candidate 1 | geometry_invalid | - | - | - | - | - | the centre electrode reaches the top of the insulator; it must stay at least 2 mm inside i |
| Candidate 2 | feasible | yes | 0.02605 kg | - | - | 3 |  |
| Candidate 3 | feasible | yes | 0.02705 kg | - | - | 2 |  |

## Configured constraints

- `heat_range_window` - Firing-end temperature inside the heat-range window (provenance: user_supplied)
- `manufacturing_min_wall` - Minimum manufacturable section (provenance: demo_fixture)

## Method and scope

**Analysis:** steady_state_thermal

Genuine 3D steady-state heat-conduction finite-element analysis of the electrode / insulator / shell assembly, with convective heat input from the combustion side, conduction into the cylinder-head seat, and convection to air at the terminal end. Each part carries its own thermal conductivity and the interfaces between them are treated as perfectly conducting.

**Solver:** scikit-fem steady-state conduction (quadratic tetrahedra) (skfem-12.0.2)

3D steady-state Fourier heat-conduction finite-element analysis with 10-node tetrahedra and per-material subdomains, verified against the analytical 1D conduction benchmark. Interfaces between assembled parts are treated as perfectly conducting. It does not model combustion, ignition discharge, cylinder pressure or flow, or any transient engine-cycle behaviour.

**Geometry template:** Simplified three-part spark-plug thermal template: centre electrode, ceramic insulator and metal shell as concentric solids of revolution with perfectly conducting interfaces. The hex, terminal, ground electrode arm, internal resistor, seals, gasket, thread form and precious-metal tips are not modelled. Thread major diameter, reach, seat position and electrode gap are preserved interfaces and cannot be changed by the optimizer.

### Not covered by this analysis

- Combustion, flame propagation and cylinder pressure
- Spark and ignition discharge, and all electrical behaviour
- In-cylinder gas flow and charge motion
- Transient engine-cycle thermal response (this is a steady-state solution)
- Contact thermal resistance between the shell, insulator and electrode
- Deposit build-up, electrode erosion and service life
- Mechanical stress, thread strength and sealing performance

### Solver verification

These benchmarks compare the same solver code path used for the results in this report against closed-form solutions.

| Benchmark | Quantity | Computed | Reference | Relative error | Result |
|---|---|---|---|---|---|
| cantilever_beam_linear_static | tip_deflection | 0.000952245 | 0.00095981 | 0.00788 | pass |
| cantilever_beam_linear_static | tip_deflection_vs_euler_bernoulli | 0.000952245 | 0.000952381 | 0.000142 | pass |
| cantilever_beam_linear_static | max_bending_stress | 1.47646e+08 | 1.5e+08 | 0.0157 | pass |
| bar_1d_steady_state_conduction | max_nodal_temperature_error | 4.77485e-12 | 0 | 4.77e-12 | pass |
| bar_1d_steady_state_conduction | heat_flow_through_cold_face | 72 | 72 | 1.84e-14 | pass |
| bar_1d_steady_state_conduction | temperature_gradient | 4000 | 4000 | 0 | pass |

### Mesh convergence

Re-solving the recommended design on a refined mesh (1695 to 22600 nodes) left the feasibility verdict unchanged, but these metrics are NOT mesh-converged: max_temperature_gradient_k_per_m +32.4% (tolerance 10%). The largest change is max_temperature_gradient_k_per_m at 32.4%. Stiffness and mass comparisons between candidates remain usable; the absolute peak values should be taken from a verification-fidelity run, and any candidate whose margin against a stress limit is smaller than this error should be re-checked.

## Assumptions and provenance

- **combustion_boundary_demo_fixture** [demo_fixture]: The default thermal load - 900 C gas at a 500 W/(m²·K) film coefficient on the firing end - is a demonstration fixture. Real values depend on the engine, the operating point and the duty cycle. The film coefficient in particular is the most uncertain input in this model and the computed temperatures scale strongly with it.
- **steady_state_only** [demo_fixture]: This is a steady-state solution: it represents a sustained operating condition, not a warm-up, a transient load change or any part of the engine cycle. Cyclic peak surface temperatures are higher than a steady-state average.
- **head_temperature_demo_fixture** [demo_fixture]: The 150 C default cylinder-head seat temperature is a demonstration fixture and is applied as a fixed temperature, which assumes the head is an ideal sink with no contact resistance at the seat.
- **heat_range_window_demo_fixture** [demo_fixture]: The 450 C to 850 C operating window is the commonly cited self-cleaning to pre-ignition range for a spark plug firing end. It is entered here as a demonstration fixture, not as a specification from a plug or engine manufacturer. Confirm the window that applies to your application.
- **perfect_interfaces** [demo_fixture]: The shell, insulator and electrode are modelled as perfectly bonded, so no contact thermal resistance is included at their interfaces. Real assemblies have some resistance, which would raise the computed firing-end temperature.
- **geometry_simplification** [demo_fixture]: Simplified three-part spark-plug thermal template: centre electrode, ceramic insulator and metal shell as concentric solids of revolution with perfectly conducting interfaces. The hex, terminal, ground electrode arm, internal resistor, seals, gasket, thread form and precious-metal tips are not modelled. Thread major diameter, reach, seat position and electrode gap are preserved interfaces and cannot be changed by the optimizer.

## Recommended next steps

1. Review every assumption listed in this report and replace the demonstration fixtures with your own engineering values.
1. Replace illustrative material data with supplier-certified properties and re-run.
1. Re-run the selected design at verification mesh fidelity if that has not already been done.
1. Add the load cases this study did not cover before committing to a physical prototype.
1. Build and physically test the selected design. This study narrows the candidates; it does not replace that test.

## Evidence and model maturity

**Simulation-evaluated candidate (Level 1)**

- **Intended use domain:** Comparative thermal screening of firing-end geometries under a declared convective boundary condition. Not an engine operating point, and not a combustion-coupled heat flux. Ladder rung S1.
- **Numerical verification:** failed
- **Physical validation:** not_available
- **Validation ladder:** S1
- **Model fidelity:** F2
- **Newest evidence:** 2026-11-03

This level was derived from recorded evidence by the deterministic assurance service. No language model assigns or raises it.

### Why this is not yet `numerically_verified`

- one or more assurance checks failed
- the decision metric moved materially when the mesh was refined

### What this level does not establish

- Feasible only under this specific solver model, mesh and load case.
- No road-safety, durability, fatigue-life or production-release claim.
- No claim of numerical accuracy - the verification gates have not all passed.

**Next rung:** S2 (Engine-coupled or cycle-averaged heat input.) is not attained: The firing-end boundary is a declared convective film condition, not a combustion-derived heat flux. No engine operating point is represented, so the absolute temperature level is model-specific.

### Assurance checks

| Check | Status | Measured | Threshold | Detail |
| --- | --- | --- | --- | --- |
| Unit consistency | `passed` | 8 | - | 8 unit-carrying quantities converted to canonical SI (m, N, Pa, kg, K, W/(m·K)). |
| Dimensional plausibility | `passed` | 0.046 m | - | Largest overall dimension 46.0 mm, inside the 10-200 mm envelope. |
| Material property completeness | `passed` | 4 | - | 4 material assignment(s) carry every property this analysis consumes, each with a declared condition. |
| Geometry integrity | `passed` | 3.763e-06 m3 | - | 3 valid solid(s), 3.8 cm3 total. |
| Preserved interface invariance | `passed` | 1.735e-18 m | 0.0003 m | 2 protected interface(s) held; largest deviation 0.00000 mm against an applied tolerance of 0.300 mm. This proves the interface to 0.300 mm, not to the 0.001 mm target: the measurement is taken on the tessellated solid, which cannot resolve finer. The deviation measured is well inside that, but only the applied tolerance is proven. |
| Semantic region mapping | `passed` | 3 | - | 3 boundary condition(s) mapped to named semantic regions out of 5 available. |
| Force-path declaration | `not_applicable` | - | - | No hydraulic force path applies to a spark_plug. |
| Thermal boundary consistency | `passed` | 820 K | - | Heat flows from 'combustion_exposed_surfaces' at 1173 C to 'terminal_end_surfaces' at 353 C, a 820 K span across 3 boundary conditions. |
| Mesh element quality | `passed` | 0.2854 | 0.1 | Worst element gamma 0.285, mean 0.821 over 7074 elements; 0 below 0.1. |
| Mesh volume fidelity | `passed` | 0.007378 | 0.02 | Meshed volume 3.7 cm3 against a CAD volume of 3.8 cm3, a 0.738% difference (tolerance 2%). |
| Result field integrity | `passed` | 1017 | - | 1017 nodes and 2030 surface triangles read back from result_fields_steady_state_operating.npz; every value finite across 3 stored arrays. |
| Decision metric present | `passed` | 1024 | - | max_temperature_k = 1024.32 (canonical SI), alongside 6 further computed metrics. |
| Load and reaction balance | `not_applicable` | - | - | A steady-state conduction run applies no mechanical loads; its equivalent check is the energy balance. |
| Boundary condition coverage | `passed` | 0.0003161 m2 | - | 3 boundary condition(s) applied; smallest resolved area 316.1 mm2. |
| Energy balance | `passed` | 3.389e-13 W | 0.02 W | power entering the solid across every boundary against power leaving it: 93.0791 W in against 93.0791 W out, a 0.0000% imbalance (tolerance 2%). A closed balance shows the model is self-consistent; it does not show the mesh is fine enough, which the convergence check covers separately. |
| Linear solve residual | `passed` | 5.453e-15 | 1e-06 | sparse direct factorisation (SuperLU) reached a relative residual of 5.453e-15 against an acceptance threshold of 1.0e-06. |
| Analytical benchmark | `passed` | - | - | Steady-state conduction through a 100 x 20 x 20 mm bar, k = 45.0 W/(m·K), 800.0 K at x = 0 and 400.0 K at x = L, remaining faces adiabatic. matched its closed-form reference (Analytical 1D conduction: linear profile T(x) = T_hot + (T_cold - T_hot) x / L, heat flow Q = k A (T_hot - T_cold) / L.). Worst quantity error 0.000%. |
| Mesh convergence | `failed` | - | 0.1 | Re-solving the recommended design on a refined mesh (1695 to 22600 nodes) left the feasibility verdict unchanged, but these metrics are NOT mesh-converged: max_temperature_gradient_k_per_m +32.4% (tolerance 10%). The largest change is max_temperature_gradient_k_per_m at 32.4%. Stiffness and mass comparisons between candidates remain usable; the absolute peak values should be taken from a verification-fidelity run, and any candidate whose margin against a stress limit is smaller than this error should be re-checked. |

### Evidence record

- **requirement revision:** `bee9f070428e2884`
- **geometry hash:** `aae3419e91610a7e4f3681f0a25dfb9a`
- **material snapshot hash:** `44a7126367619c3fcd3a428d5d6fa92f`
- **load case hash:** `1718475b92b4a2f0a3753d84e40f1cad`
- **mesh hash:** `173b1addf8604baee9e6c6acb92dbc99`
- **solver input hash:** `202f7a10b41186bd86dd3375b57c6eff`
- **solver version:** `skfem-12.0.2`
- **generator version:** `1.0.0`
- **code commit:** not available

If any of these change, every result above becomes stale and must be re-derived.

### Input provenance

| Input | Value | Source | Confirmed |
| --- | --- | --- | --- |
| 96 percent alumina technical ceramic (Al2O3) (primary) | 3e+11 Pa | `literature` | no |
| Nickel-alloy centre-electrode stock (electrode) | 2.07e+11 Pa | `literature` | no |
| 96 percent alumina technical ceramic (Al2O3) (insulator) | 3e+11 Pa | `literature` | no |
| Low-carbon steel spark-plug shell stock (shell) | 2.05e+11 Pa | `literature` | no |
| ambient temperature at combustion_exposed_surfaces | 1446.3 K | `user_supplied` | yes |
| temperature at cylinder_head_seat | 696.3 K | `user_supplied` | yes |
| ambient temperature at terminal_end_surfaces | 626.3 K | `user_supplied` | yes |
| Firing-end temperature inside the heat-range window | 1396.3 K | `user_supplied` | yes |
| Minimum manufacturable section | 0.001 mm | `demo_assumption` | no |
| The default thermal load - 900 C gas at a 500 W/(m²·K) film coefficient on the firing end - is a demonstration fixture. Real values depend on the engine, the operating point and the duty cycle. The film coefficient in particular is the most uncertain input in this model and the computed temperatures scale strongly with it. | - | `demo_assumption` | no |
| This is a steady-state solution: it represents a sustained operating condition, not a warm-up, a transient load change or any part of the engine cycle. Cyclic peak surface temperatures are higher than a steady-state average. | - | `demo_assumption` | no |
| The 150 C default cylinder-head seat temperature is a demonstration fixture and is applied as a fixed temperature, which assumes the head is an ideal sink with no contact resistance at the seat. | - | `demo_assumption` | no |
| The 450 C to 850 C operating window is the commonly cited self-cleaning to pre-ignition range for a spark plug firing end. It is entered here as a demonstration fixture, not as a specification from a plug or engine manufacturer. Confirm the window that applies to your application. | - | `demo_assumption` | no |
| The shell, insulator and electrode are modelled as perfectly bonded, so no contact thermal resistance is included at their interfaces. Real assemblies have some resistance, which would raise the computed firing-end temperature. | - | `demo_assumption` | no |
| Simplified three-part spark-plug thermal template: centre electrode, ceramic insulator and metal shell as concentric solids of revolution with perfectly conducting interfaces. The hex, terminal, ground electrode arm, internal resistor, seals, gasket, thread form and precious-metal tips are not modelled. Thread major diameter, reach, seat position and electrode gap are preserved interfaces and cannot be changed by the optimizer. | - | `demo_assumption` | no |

## Spark plug thermal validation ladder

This build has reached **S1**.

| Level | Capability | Attained | Gap |
| --- | --- | --- | --- |
| **S0** | One-dimensional thermal resistance network. | yes | - |
| **S1** | Three-dimensional steady conduction through shell, insulator and electrodes, with per-material conductivity. | yes | - |
| **S2** | Engine-coupled or cycle-averaged heat input. | no | The firing-end boundary is a declared convective film condition, not a combustion-derived heat flux. No engine operating point is represented, so the absolute temperature level is model-specific. |
| **S3** | Instrumented plug or engine test. | no | No thermocouple data. The published combustion-coupled work needed heat-transfer-coefficient tuning against measurement to reach ±10%, which this model has not had. |
| **S4** | Electrode erosion, oxidation and interface degradation. | no | Steady conduction cannot represent arc discharge, plasma energy transfer or material ablation. This is a different physics path, not a refinement of S1. |

## Claims this report does not make

- Production-ready automotive CAE
- Certified, compliant or homologated to any standard
- Fatigue life validated
- Real-time or operational digital twin
- Calibrated component twin
- A measured AI accuracy figure
- A percentage cost or time saving
- Experimentally validated
- Safe for road use
- Guaranteed not to fail

## Standing limitations

- This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.
- A candidate marked 'feasible under configured model' satisfied the constraints listed in this report and nothing more.
- Material properties are taken from the catalog snapshot recorded with each run. Where a record is tagged 'illustrative_handbook_value' it is not supplier-certified data and must be replaced before any engineering sign-off.
- Candidates that failed geometry generation, meshing or the solver carry no metrics. They are listed with their failure stage and reason rather than omitted.

> Mean solver time per candidate was 1.7 s; the whole study took 137 s.

> Re-solving the recommended design on a refined mesh (1695 to 22600 nodes) left the feasibility verdict unchanged, but these metrics are NOT mesh-converged: max_temperature_gradient_k_per_m +32.4% (tolerance 10%). The largest change is max_temperature_gradient_k_per_m at 32.4%. Stiffness and mass comparisons between candidates remain usable; the absolute peak values should be taken from a verification-fidelity run, and any candidate whose margin against a stress limit is smaller than this error should be re-checked.

> These are virtual-prototyping predictions under the model you configured. They narrow down which designs are worth building; they do not replace physical testing or any approval your process requires.
