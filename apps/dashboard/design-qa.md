# Design QA — grouped navigation rail

## Sources

- Selected reference: `/Users/eugenetoporkov/.codex/generated_images/019f6832-4c15-7911-8d98-837554f1b18f/exec-68887aee-5764-4c94-aee1-f3ca89d050b7.png`
- Implementation capture: `/var/folders/fj/w_7bmw3s06703lzn1g02k4r80000gn/T/TemporaryItems/NSIRD_screencaptureui_YQlFkj/Screenshot 2026-07-15 at 10.55.18 PM.png`
- Side-by-side comparison: `/tmp/podo-sidebar-option1-comparison.png`
- Route and state: `http://localhost:3000/safety`, desktop viewport, expanded navigation rail, Safety active.

## Comparison

### Full view

- Operations and Governance are clearly separated with compact uppercase labels.
- Safety remains the strongest selected state and Settings stays visually independent.
- Icon sizing, typography, borders, background, and spacing use the existing Podo tokens.
- The implementation preserves the reference hierarchy while matching the denser application shell.

### Focused interaction check

- The collapsed and expanded states reserve identical vertical space for section labels and dividers.
- Browser measurements keep all navigation link top positions fixed at `94, 141, 188, 235, 317, 364, 422px`; expanding the rail now changes width and opacity only.
- No pointer target moves away while the user is hovering it.

## Findings and fix history

1. Initial implementation animated section height and divider margins, shifting every link during expansion.
2. Section labels now always reserve `14px` plus fixed margins; dividers always reserve their `1px` row and margins.
3. Only label opacity/translation and divider width/opacity animate.
4. ESLint, focused navigation tests, Prettier, and `git diff --check` pass.

final result: passed
