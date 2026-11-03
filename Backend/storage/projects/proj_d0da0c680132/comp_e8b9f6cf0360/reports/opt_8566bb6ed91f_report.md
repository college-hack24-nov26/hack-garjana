# Spark Plug generative design study - E2E spark_plug

**Generated:** 2026-11-02T14:04:19.754828+00:00  
**Study:** `opt_8566bb6ed91f`  
**Component:** Spark Plug (spark_plug design)  
**Algorithm:** seeded Latin-hypercube design of experiments  
**Random seed:** 20261102

> This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.

## Outcome

**5 design(s) generated, 5 evaluated by the solver, 3 feasible under the configured constraints.**

The design space was searched with seeded Latin-hypercube design of experiments. Every candidate was built by the parametric CAD generator, meshed, and solved with the same solver configuration before being judged, so the comparison between them is like-for-like.

Candidate 4 is the best feasible generated design, but it does not beat the baseline on max_temperature_k (728.8 to 809.6). Every candidate that reached a lower value violated a constraint. The baseline remains the best feasible design in the space searched so far.

Recommended design against the baseline: mass 0.02671 to 0.02632 kg (-1.5%); peak temperature 455.6 to 536.5 C (+11.1%); minimum temperature 140.6 to 144.8 C (+1.0%); peak temperature gradient 95.55 to 102.6 K/mm (+7.4%); heat flow through the sink surfaces 33.96 to 60.84 W (+79.1%).

Constraints that ruled candidates out: Minimum manufacturable section (1), Firing-end temperature inside the heat-range window (1).

## Baseline versus recommended design

| Metric | Baseline | Recommended | Change |
|---|---|---|---|
| mass_kg | 0.02671 kg | 0.02632 kg | -1.5% |
| max_temperature_k | 455.6 C | 536.5 C | +11.1% |
| min_temperature_k | 140.6 C | 144.8 C | +1.0% |
| max_temperature_gradient_k_per_m | 95.55 K/mm | 102.6 K/mm | +7.4% |
| heat_flow_w | 33.96 W | 60.84 W | +79.1% |

## All candidates

Every generated design is listed, including those that produced no result.

| # | Status | Feasible | Mass | Peak stress | Peak displacement | Rank | Note |
|---|---|---|---|---|---|---|---|
| Baseline | feasible | yes | 0.02671 kg | - | - | 1 |  |
| Candidate 1 | infeasible | no | 0.02674 kg | - | - | 4 | manufacturing_min_wall: min_wall_thickness_m >= 1.0 mm violated (actual 0.9469 mm) |
| Candidate 2 | infeasible | no | 0.02673 kg | - | - | 5 | heat_range_window: max_temperature_k in [723.15 K, 1123.15 K] violated (actual 377.9 C) |
| Candidate 3 | feasible | yes | 0.02716 kg | - | - | 3 |  |
| Candidate 4 | feasible | yes | 0.02632 kg | - | - | 2 |  |

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

Re-solving the recommended design on a refined mesh (4415 to 6257 nodes) changed every reported metric by at most 6.0%, within the 10% tolerance, and the feasibility verdict is unchanged. The result is mesh-converged for these metrics.

## Assumptions and provenance

- **combustion_boundary_demo_fixture** [demo_fixture]: The default thermal load - 900 C gas at a 500 W/(m2.K) film coefficient on the firing end - is a demonstration fixture. Real values depend on the engine, the operating point and the duty cycle. The film coefficient in particular is the most uncertain input in this model and the computed temperatures scale strongly with it.
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

## Standing limitations

- This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.
- A candidate marked 'feasible under configured model' satisfied the constraints listed in this report and nothing more.
- Material properties are taken from the catalog snapshot recorded with each run. Where a record is tagged 'illustrative_handbook_value' it is not supplier-certified data and must be replaced before any engineering sign-off.
- Candidates that failed geometry generation, meshing or the solver carry no metrics. They are listed with their failure stage and reason rather than omitted.

> Mean solver time per candidate was 5.7 s; the whole study took 46 s.

> Re-solving the recommended design on a refined mesh (4415 to 6257 nodes) changed every reported metric by at most 6.0%, within the 10% tolerance, and the feasibility verdict is unchanged. The result is mesh-converged for these metrics.

> These are virtual-prototyping predictions under the model you configured. They narrow down which designs are worth building; they do not replace physical testing or any approval your process requires.
