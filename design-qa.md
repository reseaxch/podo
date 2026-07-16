# Design QA — Agent-analysis spotlight

- Source visual truth: `/var/folders/fj/w_7bmw3s06703lzn1g02k4r80000gn/T/codex-clipboard-d400167b-5f85-4504-b44d-ee1edcb20813.png`
- Focused source: `/var/folders/fj/w_7bmw3s06703lzn1g02k4r80000gn/T/codex-clipboard-6acf1657-91a9-46e2-8e36-588bd52856c1.png`
- Implementation reload screenshot: `/Users/eugenetoporkov/Documents/podo/podo/.scratch/auth-design-qa/agent-analysis-reload.png`
- Implementation interaction screenshot: `/Users/eugenetoporkov/Documents/podo/podo/.scratch/auth-design-qa/agent-analysis-deploy.png`
- Viewport: `1440 × 1024`
- States: `/login` immediately after reload; `/login` after inspecting the deployment node
- Full-view comparison: `/Users/eugenetoporkov/Documents/podo/podo/.scratch/auth-design-qa/agent-analysis-full-comparison.png`
- Focused comparison: `/Users/eugenetoporkov/Documents/podo/podo/.scratch/auth-design-qa/agent-analysis-focused-comparison.png`

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the agent-result card is intentionally more compact than the zoomed feedback capture so it remains fully contained by the inspection aperture.

## Required fidelity surfaces

- Fonts and typography: the auth hierarchy is unchanged. Revealed graph labels now use concise agent-result language such as `Trace collected`, `Code suspect`, `Latency evidence`, `Change detected`, `Impact mapped`, and `Queue impact`.
- Spacing and layout rhythm: system nodes retain the aligned perimeter topology. Connector lines now sit behind cards instead of crossing through their content.
- Colors and visual tokens: the white inspection interior and restrained teal ring are retained; agent outcomes reuse the existing semantic status colors.
- Image and asset fidelity: all icons come from Podo's existing pictogram library; no placeholder or improvised image assets were added.
- Copy and content: the revealed layer communicates work completed by the agent rather than repeating the underlying system-node label. The cursor cue is renamed `Agent analysis` and identifies the source service.

## Comparison history

1. P1 — A spotlight was rendered on the right immediately after page load, implying a cursor position that did not exist. Fixed by starting in the `idle` state with no coordinates painted until the first real pointer movement. Evidence: full-view comparison.
2. P2 — The reveal repeated the highlighted system block and did not communicate agent work. Fixed by mapping each source node to an evidence-oriented agent outcome. Evidence: focused comparison.
3. P2 — Revealed connector lines crossed through the graph-card surface. Fixed by placing paths at z-index 0 and node cards at z-index 2 in both faint and revealed maps. Evidence: focused comparison.

## Interaction and implementation checks

- Reload with no default spotlight or inspection cue: passed.
- First real pointer movement activates the spotlight: passed.
- Deployment inspection reveals `Change detected · v2.8.1 · 14m before spike`: passed.
- Other mapped outcomes: trace collection, code suspect, latency evidence, impact mapping, and queue impact are present.
- Spotlight pauses over the authentication card: passed.
- Coarse-pointer, reduced-motion, and mobile fallbacks are retained.
- Login and registration tests: 4 passed.
- TypeScript typecheck: passed.
- Production build: passed; `/login` and `/register` prerender successfully.
- Browser console warnings/errors: none.

final result: passed
