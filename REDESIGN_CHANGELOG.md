# Redesign changelog: Precision Engineering Studio, pass 1 (2026-11-04)

See `UI_REDESIGN_AUDIT.md` (what exists and what was wrong), `DESIGN_RESEARCH.md` (why) and `DESIGN_SYSTEM.md` (tokens and patterns). Screenshots are in `docs/redesign/`.

## What changed

### Design system (`src/theme/theme.css`, new, loaded last in `main.tsx`)
- Obsidian / titanium / ice-cyan / signal-amber palette as canonical tokens. Legacy token names are re-pointed at the new values, not renamed, so every page restyles without code changes and the printable Reports sheet keeps its local overrides.
- Panels are solid 14px-radius surfaces; panel titles are 13px sentence case; body text is 14px; engineering numbers use tabular figures.
- Buttons, segmented controls, tabs, inputs, sliders and switches share one shape language, with a consistent hover, active and disabled state and a focus ring.
- Glass is used only for controls floating over the 3D stage (view buttons, readout, legend, cylinder chips, "Model info" pill) and the command palette, with an opaque fallback when `backdrop-filter` is unsupported.
- The viewport has a neutral studio backdrop.
- `prefers-reduced-motion` is honoured globally.

### Application shell (`src/shell/*`)
- **Duplicate navigation removed.** One grouped rail: Workspace / Engineering / Analysis / Output. Compare stays removed, as the user asked.
- The rail collapses to a 68px icon rail (button or Ctrl+B, remembered per browser), and automatically below 960px. The old horizontal top nav is gone.
- Contextual top bar: a breadcrumb (AutoTwin / section / twin module), status chips with text and a dot, a "Jump to…" button, and a user avatar.
- **Status semantics fixed:** "Sim running/idle" (shown on every page) is now "Playback running/paused", shown only on the Digital Twin, with a tooltip stating it is an animation, not a solver job. The backend chip behaviour is unchanged.
- Command palette (Ctrl/Cmd+K) with every page and the three twins; arrow keys, Enter and Esc work, and focus returns to where it was.

### Digital Twin (`src/ui/TwinWorkspace.tsx`, the three `*Dashboard.tsx` wrappers)
- Parameters and Telemetry inspectors collapse independently; "Focus stage" hides both (the stage grew from 502px to 1130px wide at 1440×900). The panels stay mounted, so their inputs keep their state, and the choice is remembered.
- The stage height follows the window, so the view toolbar is visible without scrolling at 1440×900.
- "Model info" dropdown, closed by default (earlier the same day).
- Spark plug cylinder chips moved to a column so the view toolbar can't cover them.

### Dashboard (`src/pages/DashboardPage.tsx`)
- Corrected a stale claim: "Finite-element solver: Not connected in this build" now says backend studies (CadQuery, Gmsh, scikit-fem) are available from the Experiment page when the backend is online, and are not validated against test data.
- Removed the ○/◉ glyphs from the buttons.

## What was preserved
All routes, including the legacy `#/brake-caliper` and `#/spark-plug` links. Every twin control, scene, calculation and provenance badge. The A-amber / B-cyan convention. The Design Lab trust warning. The solver panel, its classes and its job states. `ABChart` props. All class names other work streams rely on (`.data-table .vtag .badge .tabs .btn .vp-btn .note .field* .select .hint .section-label`). No API or backend change.

## Tested (actually run)
`tsc --noEmit` clean. A headless-Chrome check over CDP (own browser, random port, own tab) ran twice, 29/29 both times:
- All nine routes render with the right breadcrumb and active nav item, and no console errors or exceptions.
- One global nav: 7 rail links, 0 top navs.
- Ctrl+K opens the palette; typing filters; Enter navigates (to the spark plug twin); Esc closes.
- The collapse button gives a 68px icon rail; Ctrl+B expands it again; the state persists.
- Brake twin: view toolbar visible at 1440×900; Model info starts closed and opens on click; Focus stage hides both inspectors and widens the stage; Exit focus restores them; the existing Front view and Cutaway buttons still work; the module switch still works; the top bar says "Playback …", never "Sim running".
- At 900px wide: the rail auto-collapses and there is no horizontal overflow.

Not run: `npm run build` (it would overwrite `dist/`), cross-browser checks other than Chrome, and GPU memory profiling.

## Not done yet (honest scope)
| Item | Why |
|---|---|
| Design Lab A/B difference summary ("changed parameters only") | Next step; no owner conflict |
| Experiment lifecycle stepper (choose, configure, review, run, evaluate) | Page is owned by another work stream; needs coordination |
| Analytics, AI Insights and Reports page-level redesign | Owned by other work streams; they receive the new tokens and components automatically |
| Twin part selection, Engineering Focus Mode levels 1–5, isolate/hide | Only `FocusViewer` (AI Insights) has part data; porting it to the twins is real work, not a restyle |
| Reusable value-provenance popover (value, unit, source, method, revision, run) | Design is ready; needs per-value metadata plumbing |
| Studio lighting pass on the three scenes | Scene files are owned by the module work streams |
| Undo/redo | Not implemented in the store; no shortcut was added |
| GPU disposal audit (`renderer.info`) | Not measured |

## Known issues
- With the full rail and both inspectors open at 1440px, the stage is about 50% of the content width. Collapsing the rail or an inspector gets it to 60–100%.
- The spark plug "display sampling" warning still sits over the top-centre of the engine while it is aliased (this is existing behaviour, kept deliberately because it is a truth warning).
- The sidebar wheel illustration is decorative and is hidden in the icon rail and on short windows.
