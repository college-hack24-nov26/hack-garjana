# Brake Caliper generative design study - E2E brake_caliper

**Generated:** 2026-11-02T17:30:22.512710+00:00  
**Study:** `opt_2901b687aa4b`  
**Component:** Brake Caliper (brake_caliper design)  
**Algorithm:** seeded Latin-hypercube design of experiments  
**Random seed:** 20261102

> This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.

## Outcome

**4 design(s) generated, 2 evaluated by the solver, 0 feasible under the configured constraints, 2 failed to evaluate.**

The design space was searched with seeded Latin-hypercube design of experiments. Every candidate was built by the parametric CAD generator, meshed, and solved with the same solver configuration before being judged, so the comparison between them is like-for-like.

No generated candidate satisfied every configured constraint. 1 candidate(s) were evaluated. Widen the design bounds, relax a constraint that is not a hard requirement, or increase the candidate budget.

Candidates that produced no result: 2 at the parameter_validation stage. They carry no metrics and are excluded from ranking.

Constraints that ruled candidates out: Mouth opening within allowable (2).

## All candidates

Every generated design is listed, including those that produced no result.

| # | Status | Feasible | Mass | Peak stress | Peak displacement | Rank | Note |
|---|---|---|---|---|---|---|---|
| Baseline | infeasible | no | 1.706 kg | 143 MPa | 0.1961 mm | 2 | mouth_opening_limit: max_displacement_m <= 0.15 mm violated (actual 0.1961 mm) |
| Candidate 1 | geometry_invalid | - | - | - | - | - | slot depth (74.3 mm) plus bridge thickness (21.8 mm) exceeds the body height (93.3 mm): th |
| Candidate 2 | geometry_invalid | - | - | - | - | - | a 48.0 mm bore does not fit within the 27.3 mm slot depth with 4 mm of edge material; incr |
| Candidate 3 | infeasible | no | 2.247 kg | 110.7 MPa | 0.1625 mm | 1 | mouth_opening_limit: max_displacement_m <= 0.15 mm violated (actual 0.1625 mm) |

## Configured constraints

- `stress_limit` - Peak stress within allowable (provenance: user_supplied)
- `mouth_opening_limit` - Mouth opening within allowable (provenance: user_supplied)
- `manufacturing_min_wall` - Manufacturable wall thickness (provenance: user_supplied)

## Method and scope

**Analysis:** linear_static_structural

Linear static structural analysis of a simplified fixed-caliper body under a clamping load case: hydraulic pressure on the piston bore pocket and the equal-and-opposite pad reaction on the outboard leg, with the mounting holes fixed. This is the load case that opens the caliper mouth.

**Solver:** scikit-fem linear elasticity (quadratic tetrahedra) (skfem-12.0.2)

3D linear-elastic small-displacement finite-element analysis with 10-node tetrahedra, verified against the analytical cantilever-beam benchmark. It does not model fatigue, impact, contact, bolt pretension, plasticity or casting defects, and it is not a certification of road-worthiness.

**Geometry template:** Simplified fixed-caliper body template: U-shaped channel over the disc, piston bore pocket in the inboard leg, mounting holes through the inboard leg, optional bridge ribs. The hydraulic circuit, seal grooves, pistons, pads, disc, and casting draft are not modelled. Disc slot width, piston bore diameter, mounting hole pattern and body length are preserved interfaces and cannot be changed by the optimizer.

### Not covered by this analysis

- Hydraulic circuit, fluid compressibility and seal behaviour
- Piston, pad, disc and dust-boot contact mechanics
- Brake thermal analysis and thermal distortion
- Fatigue, wear and brake-system validation
- Brake torque reaction through the mounting bolts as a separate load case
- Any regulatory or road-use approval

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

## Assumptions and provenance

- **hydraulic_pressure_demo_fixture** [demo_fixture]: The 10 MPa default line pressure is a demonstration fixture representing a firm brake application. It is not taken from a vehicle brake-system specification.
- **clamping_load_model** [demo_fixture]: The clamping load is modelled as hydraulic pressure on the piston bore pocket plus an equal and opposite resultant force spread over the outboard pad abutment face. The piston, pads and disc are not modelled, and pad pressure distribution is assumed uniform.
- **mounting_constraint_simplification** [demo_fixture]: The two mounting hole barrels are fully fixed. Bolt pretension, friction and contact separation at the knuckle are not modelled, so stress around the mounting holes is indicative only.
- **brake_torque_not_modelled** [demo_fixture]: Only the clamping (mouth-opening) load case is analysed. The brake torque reaction that acts circumferentially through the mounting bolts is a separate load case and is not included here.
- **allowable_stress_demo_fixture** [demo_fixture]: The 165 MPa default allowable stress is a demonstration value derived as roughly the 250 MPa catalog yield of EN-GJS-400-18 divided by a safety factor of 1.5. The 0.15 mm default mouth opening limit is likewise illustrative. Both are stated so the constraint is active across the design space; replace them with limits from your own design standard and certified material data.
- **geometry_simplification** [demo_fixture]: Simplified fixed-caliper body template: U-shaped channel over the disc, piston bore pocket in the inboard leg, mounting holes through the inboard leg, optional bridge ribs. The hydraulic circuit, seal grooves, pistons, pads, disc, and casting draft are not modelled. Disc slot width, piston bore diameter, mounting hole pattern and body length are preserved interfaces and cannot be changed by the optimizer.

## Standing limitations

- This report contains virtual-prototyping predictions produced under the engineering model recorded below. It is not a regulatory certification, not an approval for road use, and not a substitute for physical validation.
- A candidate marked 'feasible under configured model' satisfied the constraints listed in this report and nothing more.
- Material properties are taken from the catalog snapshot recorded with each run. Where a record is tagged 'illustrative_handbook_value' it is not supplier-certified data and must be replaced before any engineering sign-off.
- Candidates that failed geometry generation, meshing or the solver carry no metrics. They are listed with their failure stage and reason rather than omitted.

> Mean solver time per candidate was 25.6 s; the whole study took 53 s.

> These are virtual-prototyping predictions under the model you configured. They narrow down which designs are worth building; they do not replace physical testing or any approval your process requires.
