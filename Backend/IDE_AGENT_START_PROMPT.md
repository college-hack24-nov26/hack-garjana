# IDE Agent - Start Here

You are the implementation agent for the AutoTwin generative automotive engineering and virtual-prototyping hackathon project.

## Read these files first

1. `AutoTwin_Generative_Engineering_Build_Spec.md` - authoritative product, engineering, architecture, API, implementation, testing and acceptance specification.
2. `BUILD_TRACKER.md` - live task, phase, component-readiness and blocker tracker.

Read both files completely before changing the repository.

## Your operating instructions

1. Inspect the existing repository, operating system, Python/Node versions, installed CAD tools and solver binaries before scaffolding or changing files. Preserve existing user work.
2. Treat the build specification as the source of truth. If a requirement conflicts with the current repository, explain the conflict and choose the smallest safe change.
3. The exact official hackathon problem statement has not yet been supplied. The specification contains a working interpretation, not an organizer quotation. Do not invent official requirements. Keep the product focused on generative automotive virtual prototyping that reduces avoidable physical-prototype iterations.
4. Build for a 24-hour hackathon. Prioritize a working, repeatable engineering vertical slice over extra screens or unfinished advanced features.
5. The three component profiles are Alloy Wheel, Brake Caliper and Spark Plug. Reuse one platform architecture, but keep their geometry parameters, engineering inputs, analysis types and validation rules component-specific.
6. Support both `Improve Existing Design` and `Generate New Design from Requirements` using bounded, parameterized templates. Do not claim arbitrary STEP files can be automatically redesigned unless feature recognition and modification have actually been implemented.
7. Keep responsibilities separate: the LLM interprets requirements and explains verified outputs; the CAD engine creates geometry; the optimizer searches design variables; the physics solver evaluates candidates; the validation layer decides whether configured constraints pass.
8. Never fabricate meshes, FEA results, heatmaps, stress, displacement, temperature, accuracy, safety, cost savings or candidate pass/fail states. If a solver is unavailable, use only the explicitly documented fallback and label it clearly.
9. Ask for missing engineering inputs rather than inventing material properties, loads, constraints, interfaces or boundary conditions. Keep units explicit and preserve protected mounting/assembly interfaces.
10. Implement phase by phase. After each phase, update `BUILD_TRACKER.md` with status, owner, files changed, commands/tests run, acceptance evidence, known issues and next action.
11. Keep the application locally runnable. Do not introduce Redis, Celery, Docker, Kubernetes, PostgreSQL or microservices unless an actual blocker justifies them.
12. Before declaring completion, run the backend tests, frontend build, CAD/mesh/solver benchmarks and full demo workflow. Record exact commands and outcomes.

## First actions

1. Perform environment and solver preflight; record executable paths and versions.
2. Confirm that FreeCAD/CadQuery, Gmsh and the selected structural and thermal solver paths are usable, or document the fallback.
3. Create one small structural benchmark and one thermal benchmark before integrating them into the UI.
4. Implement the Alloy Wheel as the first end-to-end vertical slice: requirements -> parameterized geometry -> mesh -> structural solve -> candidate generation -> re-simulation -> comparison -> export -> 3D visualization.
5. Only after that loop works, add the Brake Caliper and Spark Plug profiles using the same interfaces and their own validated analysis configurations.

Start by reporting the repository/environment findings and updating the tracker. Then proceed with the first unblocked implementation phase. Do not spend the hackathon building a chatbot before the CAD-to-simulation-to-generation loop works.
