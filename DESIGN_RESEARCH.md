# Design research

Pages were read on 2026-11-04. Apple's HIG pages (Materials, Layout) render client-side, and the fetch returned only their titles. Those rows rely on prior knowledge of the published guidance and are marked as such.

| Reference | What was studied | Principle we took | How it shows up in AutoTwin | What we did not copy |
|---|---|---|---|---|
| Apple HIG: Materials *(page did not load; from prior knowledge)* | Translucent materials as a separate layer for controls | Glass means "this floats above content and is a control" | Glass only on floating viewport buttons, the readout, the legend, the "Model info" pill and the command palette. Solid surfaces for forms, telemetry and warnings | Glass on content cards, glass on glass, decorative blur |
| Apple HIG: Layout *(page did not load; from prior knowledge)* | Hierarchy between content and controls, consistent margins, grouping | Content first, controls recede; a single spacing scale | 4px spacing scale, 28px page titles, the 3D stage as the visual anchor, inspectors that can step away | iOS-specific metrics and fonts (SF Pro isn't available on Windows) |
| Ansys Discovery (Model / Explore / Refine) | Stages you can move between at any time; Model has "no distraction of simulation controls or results" | Separate stages by purpose and fidelity | Nav groups (Engineering vs Analysis vs Output); fidelity stated per number (estimate vs backend solver) | Any implication of Ansys-level real-time solving |
| Autodesk Fusion workspaces | Purpose-driven workspaces; contextual tabs that appear only when a command needs them | Show tools only in their context | Twin-only status (playback chip shows only on Digital Twin); inspectors only where they apply | A ribbon toolbar |
| Onshape UI basics | Toolbar groups separated by dividers; adaptive density at low resolution; per-tab undo | Density adapts to space | The rail collapses to icons below 960px or with Ctrl+B; inspectors collapse; the top bar drops labels below 1180px | Colour-coded selection fields (no selection model in the twins yet) |
| MDN backdrop-filter | Baseline 2024; needs a semi-transparent background; "backdrop root" rules (opacity, filter, mask on an ancestor limit what gets blurred) | Always ship an opaque fallback; never put glass inside a faded or masked parent | `@supports not (backdrop-filter)` falls back to a 95%-opaque surface. Glass elements sit directly in `.viewport` | Large blurred panels over the WebGL canvas |
| WCAG 2.2 | 1.4.3 (4.5:1 text), 1.4.11 (3:1 UI), 2.4.7/2.4.11 focus, 2.5.8 target ≥24×24px, 2.3.3 motion | Visible focus, real targets, motion opt-out | A focus ring token on every control, rail targets 40–44px, viewport buttons 30px, status uses text plus a dot (not colour alone), and `prefers-reduced-motion` stops the sidebar spin and transitions | |
| R3F pitfalls | No setState in `useFrame`; reuse geometry and materials; `visible` instead of mount/unmount | Shell changes must not re-render scenes | The inspector toggle uses `hidden`; nothing new runs per frame; scenes untouched | |
| three.js disposal | GPU resources need explicit `dispose()`; check with `renderer.info` | Audit item | Not changed in this pass. Listed in the known limitations | |

## Resulting decisions

1. Exactly one navigation surface (the rail). The top bar holds context and status only.
2. Two materials: **solid** for anything you read or edit, **glass** for small controls floating over 3D.
3. Status words are literal: "Playback running" for the twins; "Backend online/offline"; solver job states come from the backend.
4. The model is the anchor: collapsible inspectors, a Focus stage mode, and a stage sized to the window.
