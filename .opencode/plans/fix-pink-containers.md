# Fix: bake container colors into the rendered presentation — single simplified mechanism

## Goal
Container colors derived from each slide's `data-background-color`, hard-coded into the final rendered HTML — identical in every browser. Simplify to **one mechanism** (render-time baking); remove the now-redundant runtime pieces.

## Feasibility (verified earlier)
- Pandoc revealjs writer passes `data-background-color` from slide headers to `<section>` (verified); sections get stable ids.
- Spec-faithful OKLab port in Lua matches Chrome 156's engine output to 4 decimals on the beige palette.
- Quarto 1.10.18: bake at AST level via Lua filter; `quarto.doc.include_text("in-header", …)` injects the style block.

## Files

### 1. NEW `_extensions/monaxue/containerstheme/containers-bake.lua`
Registered in the extension's `_extension.yml` under `contributes.formats.revealjs.filters` (after `column-card.lua`; auto-runs with the `containerstheme-revealjs` format; guarded by `quarto.format.is_revealjs_output()`).

**Config:** `containers-bg-default` via `quarto.doc.metadata` — project default in `presentations/_metadata.yml`, per-deck override in a qmd header, fallback `#ffffff`. Keep `title-slide-attributes.data-background-color` equal to it (title's visible bg still comes from there — the writer generates that section).

**Logic:**
1. Walk doc blocks in order; slides = Header level 1–2.
2. Effective bg = header's `data-background-color`/`background-color` attr if present, else carried-forward `lastBg` (init: `containers-bg-default`).
3. If attr absent → set `header.attributes["data-background-color"] = effective` (bakes visible backgrounds; reveal paints them statically from first paint — replaces bg.html's runtime carry-forward).
4. Derived color in Lua (spec OKLab): chromatic → `L−0.07`, `C+0.04`, same hue, gamut-clamped → `rgba(r,g,b,1)`; achromatic (C < 0.005) → NO chroma boost, neutral `L−0.07` gray (never pink). Parser: `rgba()/rgb()`, `#hex`; failure → warn + neutral white.
5. Accumulate `#<slide-id> { --bg: <effective>; --li-bg-1: <derived>; }` + one `#title-slide` rule (from `containers-bg-default`).
6. Inject once: `quarto.doc.include_text("in-header", "<style>…</style>")`.

### 2. `_extensions/monaxue/containerstheme/_extension.yml`
- Add `containers-bake.lua` to contributed filters.
- REMOVE `include-after-body: bg.html` — fully redundant (backgrounds + `--bg` now baked at render).

### 3. DELETE `_extensions/monaxue/containerstheme/bg.html`
No runtime color JS remains. (File is in git history if ever needed.)

### 4. `_extensions/monaxue/containerstheme/containers.scss`
- Replace the engine-dependent formula (line 100) with a plain literal safety fallback:
  ```scss
  .reveal .slide {
    --li-bg-1: rgba(244, 223, 184, 1);   /* #f4dfb8 — only used if a slide somehow misses a baked rule */
    --li-bg-2: var(--bg);
    @include card-list-styles;
  }
  ```
- Everything else unchanged (all `var(--li-bg-1/-2)` consumers, `:root --bg` fallback).

### 5. `presentations/_metadata.yml`
- Add top-level `containers-bg-default: "rgba(254, 248, 237, 1)"` (all decks beige by default, incl. casestudy1/demo/test; per-deck override `containers-bg-default: "#ffffff"` → white slides + gray containers).

## Resulting rendered HTML
- Every `<section … data-background-color="…">` — static
- One `<style>` block with literal rgba rules incl. `#title-slide`
- Zero `oklch(` anywhere; zero runtime color JS — identical in every browser (floor: CSS custom properties, which reveal.js 4 already requires); correct with JS disabled, in print/PDF export, presenter view, first paint.

## Render + verify
1. `quarto render`.
2. Grep rendered decks: every `<section` has `data-background-color`; injected `<style>` block present; `var defaultBg` absent (bg.html gone); `grep -c "oklch(" theme css` → 0.
3. Headless-Chrome probe (existing harness): week14 `li bg = rgb(244, 223, 184)`-ish (literal serialization proves the bake won — was `oklch(0.91 …)` before); casestudy1 → beige default; correct at earliest probe (no Reveal-ready timing dependence); title-slide vars applied.
4. Sanity: baked rgba values match Chrome's engine output for the same source colors (cross-validated in diagnosis).

## Notes
- Pandoc duplicates the baked attr onto the inner `<h2>` (inert).
- Title slide's visible bg stays via `title-slide-attributes` (format option the filter can't read) — keep equal to `containers-bg-default`.
- Re-enabling the `background-colors` rotation works per-slide with no extra changes.
- Colors re-bake every render; changing a bg color requires re-render.
- Rollback: `git revert` — all changes tracked.

## Bugfix 1 (post first render): grey containers — wrong metadata API
**Symptom:** casestudychecklist.html (rendered Nov 6 13:12) has all rules `--li-bg-1: rgba(232, 232, 232, 1)`, `#title-slide { --bg: #ffffff; … }`, sections `data-background-color="#ffffff"`.
**Cause:** filter read the default via `quarto.doc.metadata` — that field does not exist in Quarto's Lua API (verified against `/opt/quarto/share/lua-types/quarto/doc.lua`) → nil → `defaultBg` fell back to `#ffffff` → achromatic derivation → grey.
**Fix in `containers-bake.lua`:** read the default via the documented API, with fallbacks:
```lua
local m
if quarto.metadata and quarto.metadata.get then
  m = quarto.metadata.get("containers-bg-default")   -- {{< meta >}} equivalent; includes merged _metadata.yml
end
if m == nil then
  m = doc.meta["containers-bg-default"]              -- pandoc merged metadata fallback
end
if m then defaultBg = pandoc.utils.stringify(m) end
```
Then a full `quarto render` (only casestudychecklist + week3 were re-rendered; all decks must re-bake).
**Expected after fix:** sections `data-background-color="rgba(254, 248, 237, 1)"`; rules `--li-bg-1: rgba(244, 223, 184, 1)`-ish; no `rgba(232, 232, 232, 1)` anywhere.
