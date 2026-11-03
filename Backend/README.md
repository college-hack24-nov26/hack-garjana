# AutoTwin

**From engineering requirements to newly generated, virtually tested automotive
component designs.**

A locally runnable generative engineering and virtual-prototyping platform:
parametric CAD generation, real finite-element analysis, constrained design
exploration, traceable results and an interactive 3D workspace.

> AutoTwin produces virtual-prototyping predictions under an explicitly
> configured engineering model. Results are **not** a regulatory certification,
> **not** an approval for road use, and **not** a substitute for the physical
> validation your process requires.

---

## What it actually does

Three automotive components share one platform, one pipeline and one set of
interfaces, but each keeps its own geometry, physics, objectives and limits:

| Component | Analysis | Design variables | Headline constraint |
|---|---|---|---|
| **Alloy wheel** | Linear static structural | Spoke count, widths, thickness, dish offset, hub and rim wall | Peak von Mises stress, radial deflection |
| **Brake caliper** | Linear static structural | Wall and bridge thickness, body height, slot depth, rib count and thickness | Peak stress, caliper mouth opening |
| **Spark plug** | Steady-state thermal, 3 materials | Insulator nose length and diameter, electrode diameter and length | Firing-end temperature inside its heat-range window |

Each candidate is genuinely built in CAD, meshed, solved, and judged against
constraints you configured. Nothing is estimated, interpolated or scored by a
language model.

### The honesty rules this build enforces

- A candidate that fails geometry, meshing or the solver carries **no metrics**.
  It is listed with its failure stage and reason, and can never be ranked or
  recommended.
- A constraint whose metric was never computed is **not a pass** — it blocks
  feasibility.
- Every load is integrated back to a resultant and checked against its intended
  value before the result is accepted.
- Every engineering number carries a unit, and every pre-filled value is tagged
  as a demonstration fixture that you must explicitly accept before a run.
- Coarse-mesh results are re-solved on a refined mesh, and the platform reports
  when a metric is **not** mesh-converged or when the feasibility verdict changed.
  Convergence is recorded in four states - `not_run`, `passed`, `failed`,
  `inconclusive` - and judged on the quantity the decision rests on. A metric
  that is singular by construction, such as a peak gradient at a material
  interface, keeps growing however fine the mesh gets; that makes a study
  `inconclusive` and is named in the report, not quietly dropped and not
  reported as a defect in the design.
- Every result carries an **evidence-derived maturity level** (L0-L5). A
  deterministic check service assigns it from recorded measurements; no language
  model can set or raise it. This build reaches **L2 (numerically verified)** at
  best, and only for a candidate whose refinement study passed.
- A check that **did not run is not a pass.** `not_run` and `warning` are
  distinct states from `passed`, and either blocks a verification claim.
- Physical validation is reported as **not available**, because no physical
  measurement exists in this installation. That is a different state from
  "validated" and from "failed", and nothing promotes it.
- Generated prose is scanned for prohibited claims — certification, fatigue
  life, a real-time twin, a percentage cost saving — **after** it is written.

---

## Evidence and maturity

Every number the platform shows travels with the level of evidence behind it.

| Level | Name | What it takes |
|---|---|---|
| L0 | Virtual prototype | A valid solid. No solver has run. |
| L1 | Simulation-evaluated | A solver completed and its constraints were evaluated. |
| L2 | Numerically verified | Every blocking assurance check passed, the analytical benchmark matched, the balances closed, and the decision quantity is mesh-converged. |
| L3 | Experimentally validated | Comparison against independent physical measurement. **Not reachable here.** |
| L4 | Calibrated component twin | Bound to an identified physical part. **Not reachable here.** |
| L5 | Operational predictive twin | A live data link with drift monitoring. **Not reachable here.** |

Seventeen deterministic checks run in two stages: a pre-solver gate that can
reject a candidate before a solve is spent, and a post-solver gate that decides
whether a result may be called verified. Each verdict is a measurement against
a threshold, and the UI shows both.

Each component also sits on its own validation ladder — W0-W4 for the wheel,
C0-C4 for the caliper, S0-S4 for the plug. This build reaches **W1, C1 and S1**,
and every higher rung is listed with what it would require, so the distance
between a screening result and a durability claim is visible rather than implied.

A seeded failure suite (`app/tests/test_assurance.py`) injects fourteen specific
defects — mm read as m, a grade without its temper, a load on a region that does
not exist, hydraulic pressure used as a pad force, swapped thermal boundaries, a
solver that exits clean with NaN in its output — and asserts the gates catch
each one. **False-acceptance rate: 0 of 14.**

---

## Requirements

- **Python 3.10** (3.11 also works; 3.13 does not — CadQuery's OCP wheels stop at 3.12)
- **Node.js 20+** and npm
- Windows, macOS or Linux. Built and verified on Windows 11 / CPython 3.10.0.

No CalculiX, Elmer, FreeCAD, Docker, Redis or database server is required. The
finite-element solvers run in-process.

---

## Setup

### Backend

```bash
cd backend
py -3.10 -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

python -m pip install --upgrade pip
pip install -r requirements.txt

copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
```

Verify the toolchain before writing or running anything else:

```bash
python -c "import fastapi, numpy, scipy, trimesh, cadquery, gmsh, pymoo, skfem, meshio; print('core imports OK')"
```

### Frontend

```bash
cd frontend
npm install
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
```

---

## Running

Two terminals.

**Terminal 1 — API** (from `backend/`, with the venv active):

```bash
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — UI** (from `frontend/`):

```bash
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>).
API docs are at <http://127.0.0.1:8000/docs>.

The first page load runs both solver verification benchmarks, so it takes a few
seconds. The header shows **solvers verified** once they pass.

### If it will not start

**`[Errno 10048] error while attempting to bind` / "address already in use"** —
something is already on port 8000, usually a previous run that was closed
without stopping the server. Find and stop it:

```bash
netstat -ano | findstr :8000        # last column is the PID
taskkill /PID <pid> /F
```

Or just use a different port on both sides:

```bash
uvicorn app.main:app --reload --port 8010
```

then set `VITE_API_BASE=http://127.0.0.1:8010` in `frontend/.env` and restart
`npm run dev`.

**UI shows "backend offline"** — the API is not running, or it is on a different
port than `VITE_API_BASE` in `frontend/.env`. Check
<http://127.0.0.1:8000/api/health> returns JSON.

**`ModuleNotFoundError`** — the virtual environment is not active. The prompt
should show `(.venv)`.

**Browser shows a blank page** — open the dev server on the URL Vite prints
(`http://localhost:5173`). Vite binds to `localhost`, which on some Windows
setups is IPv6-only, so `http://127.0.0.1:5173` may not respond even though
`localhost` does.

---

## The workspace

Six sections, ordered the way the work is done:

| Section | What it is for |
|---|---|
| **Dashboard** | What AutoTwin does, and the three ways in |
| **New Design** | The guided five-step wizard — this is the core |
| **Improve Existing** | Upload a CAD file, inspect it, map it to a template |
| **Simulation Results** | The 3D viewport with the computed field, and the numbers |
| **Design Comparison** | Original versus optimised, and every candidate |
| **Export & Reports** | STEP files and the traceability document |

The last three unlock once a simulation has run; they are visibly disabled
until then rather than leading to empty pages.

### The New Design wizard

You are never shown twenty fields at once. Each step asks for one kind of thing:

1. **Component** — alloy wheel, brake caliper or spark plug
2. **Requirements** — describe it in plain words; the assistant extracts the
   values you stated and lists what is still missing
3. **Parameters** — grouped as **A Geometry**, **B Material**,
   **C Engineering conditions**. Only fields relevant to your component appear
4. **Optimization** — pick what to improve; design-variable bounds and search
   settings sit in an Advanced section
5. **Generate** — build, mesh and solve, with the 3D viewport live beside it

Every value shows where it came from: `your input`, `AI proposed`, `catalog`,
`protected` for preserved interfaces, or `required` for something still missing.
A demonstration fixture never looks like a confirmed requirement, and the
generate button stays disabled with the reasons listed until the gaps are filled.

### Two speeds, clearly separated

- **While you edit**, closed-form reduced-order models answer in microseconds,
  so numbers move as you drag. Everything there is tagged `estimate`.
- **When you generate**, the real thing runs: parametric CAD, a tetrahedral mesh
  and a finite-element solve, tens of seconds per candidate. Those results are
  tagged `solver` and are what the ranking, the comparison and the report use.

The estimators are calibrated against the solver and each states its own error:
the spark-plug thermal network lands within about 10% of the 3D solve, the wheel
within about 5% on stress, and the caliper reads substantially low on stress
because a beam model cannot represent the local concentration at the bore. Those
figures are printed in the UI, not hidden.

### The animations

Each component has its own animation on the Experiment page, and all three are
built from the **live design parameters** — change the spoke count or the
insulator nose length in the Design Lab and the model on screen changes with it.
What moves is the design under test, not a stand-in.

**Spark plug — inline-four engine cutaway.** Driven by real slider-crank
geometry: piston travel comes from the crank radius and rod length, firing order
is 1-3-4-2, and pistons 1/4 move against 2/3 as on a real inline-four. Flame
kernels follow an ignition-advance envelope through the power stroke. Plug tip
colour comes from the computed temperature. Views: *Engine cutaway*,
*Slider-crank side*, *Spark-plug tips*.

**Alloy wheel — rolling road load.** The point is that a road wheel is loaded
*cyclically*: the contact patch stays at the bottom while the wheel turns
through it, so every spoke is loaded and unloaded once per revolution. That is
what drives rotary bending fatigue, and a static FEA picture cannot show it. The
highlighted sector is the same 50° patch the solver loads. Views: *Road
contact*, *Wheel face*, *Loaded spoke*.

**Brake caliper — one brake application.** Pressure rises, pistons push the pads
onto a spinning disc, friction decelerates it and heats the rubbing band, and
the caliper mouth opens under the clamping load. The mouth opening is the
solver's computed deflection, exaggerated so a tenth of a millimetre is visible;
the factor and the true value are both on screen. Views: *Disc assembly*,
*Caliper detail*, *Mouth opening*.

#### What is real and what is context

In each case the surrounding machinery — the engine block, the road, the brake
disc — is **illustrative context** and is labelled as such in the viewport. The
component itself is your parametric design, and the values that colour it come
from the solver when a result exists.

One honesty detail worth knowing: at 6,000 rpm and real time the crank advances
600° per display frame, so the rendered motion would be stroboscopic and read as
far slower than it is. The default time scale is 1/50, and if you raise it the
viewport says plainly that the motion is aliased.

## Tests

```bash
cd backend
pytest                      # everything, ~7 minutes
pytest -m "not slow"        # fast contract and API tests, ~15 seconds
pytest -m benchmark         # solver verification only
```

```bash
cd frontend
npm run build               # type-check and production build
npm test                    # 37 kinematics tests
```

The frontend tests verify the animation maths, because an animation that moves
convincingly but wrongly teaches the wrong thing: that the piston never exceeds
its stroke, that exactly one cylinder fires per 180°, that every spoke is loaded
exactly once per wheel revolution, and that the disc only decelerates while
clamped.

---

## Architecture

```
backend/app/
  api/routes/        31 HTTP endpoints
  core/              config, logging, units, safe identifiers
  db/                SQLAlchemy models, session
  schemas/           typed request/response and engineering contracts
  services/          job manager, pipeline, exploration, cost, report, artifacts
  engineering/
    cad/             generators, regions, validation, import/export
    meshing/         Gmsh runner, conformal multi-material assembly
    solvers/         adapter contract, structural, thermal, linear algebra
    optimization/    sampling, evaluation, ranking, NSGA-II
    materials/       controlled catalog with provenance
    ai/              requirement parser, result explainer
  tests/             141 tests including solver benchmarks
frontend/src/
  components/        viewer, setup, results
  services/          typed API client
  store/             Zustand state
  types/             TypeScript mirrors of the backend contracts
```

**Separation of responsibilities**, as the specification requires: the LLM
interprets and explains, the CAD engine builds geometry, the optimizer searches,
the solver computes, and the validation layer decides feasibility. No component
does another's job.

| Layer | Technology |
|---|---|
| CAD kernel | CadQuery 2.7 (OpenCascade) |
| Meshing | Gmsh 4.15 (OCC kernel) |
| Structural solver | scikit-fem, 10-node tetrahedra, linear elasticity |
| Thermal solver | scikit-fem, steady-state conduction, per-material subdomains |
| Linear algebra | pyamg AMG-preconditioned CG, SuperLU fallback |
| Optimization | Seeded Latin-hypercube DOE, pymoo NSGA-II |
| API | FastAPI + Pydantic v2 |
| Persistence | SQLite + on-disk artifacts |
| Frontend | React 19, React Three Fiber 9, Zustand, Vite |

### On the solver choice

The specification nominates CalculiX and Elmer. Neither is installed on the
target machine and there is no WSL or conda to install them into, so the physics
runs on **scikit-fem** in-process. That is a real finite-element library, not
the reduced-order fallback the spec allows when a solver is missing — which is
why the spark plug gets genuine 3D thermal FEA rather than a thermal network.

Both paths are verified against closed-form solutions before any automotive
number is displayed:

| Benchmark | Quantity | Error vs reference |
|---|---|---|
| Cantilever beam | Tip deflection | 0.014% vs Euler-Bernoulli |
| Cantilever beam | Peak bending stress | 1.6% vs M c / I |
| 1D conduction | Heat flow | 1.8e-14 |
| 1D conduction | Temperature field | 4.8e-12 K |

`/api/capabilities` reports these results and states plainly that CalculiX and
Elmer are absent. The `SolverAdapter` interface is unchanged, so setting
`CALCULIX_BIN` can register a CalculiX adapter alongside these without changing
any caller.

---

## Configuration

`backend/.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./autotwin_dev.db` | Project and run records |
| `STORAGE_ROOT` | `../storage` | STEP, GLB, mesh and result artifacts |
| `CALCULIX_BIN` | empty | Optional external structural solver |
| `ELMER_BIN` | empty | Optional external thermal solver |
| `LLM_API_KEY` | empty | Optional. Everything works without it. |
| `JOB_WORKER_THREADS` | 2 | Concurrent engineering jobs |

The assistant and explainer run deterministically offline by default. An LLM is
an enhancement whose output is re-validated against the same schemas; it can
never supply a load, a limit or a material property.

---

## Known limitations

Recorded honestly, and surfaced in the UI and in every generated report:

- **Peak stress is not mesh-converged at screening fidelity** — it moves ~50%
  between 16 mm and 7 mm meshes on the wheel, while displacement and mass move
  under 1%. Rank candidates at screening fidelity; take absolute values from a
  verification run. The platform reports this per study.
- **The spark plug's peak temperature gradient never converges** — measured
  live from 1,695 to 22,600 nodes it moves +32.4%, while peak temperature moves
  −0.73% and heat flow +1.30%. This is a real singularity at a material
  interface, not a modelling error and not something refinement will fix. The
  decision quantity is converged, so the result reaches L2; the study is
  recorded `inconclusive` and that limitation travels with every report.
- **Material data is illustrative**, not supplier-certified.
- **Imported STEP is not parametric** — viewable and analysable, but the search
  cannot regenerate it.
- **One load case per profile** — the wheel runs a radial case, the caliper
  clamping only (no brake torque), the spark plug one steady operating point.
- **Geometry is simplified** — no bead flanges or drop centre on the wheel, no
  hydraulic circuit on the caliper, no ground electrode on the spark plug.
- Fatigue, impact, contact, plasticity, transient thermal and combustion are all
  out of scope.

`BUILD_TRACKER.md` carries the full evidence, the phase log, and the bugs found
and fixed during the build.
