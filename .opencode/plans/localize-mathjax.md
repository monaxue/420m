# Fix: LaTeX fails on other devices — vendor MathJax 2.7.9 locally; audit remaining external deps

## Goal
Math in the revealjs decks renders on any device that can reach monaxue.github.io, regardless of CDN availability/firewalls/ad-blockers. No other runtime network dependencies sneak in. No visual change to any rendered formula.

## Diagnosis (verified)
- All 15 rendered decks load **MathJax 2.7.9 from `https://cdn.jsdelivr.net/npm/mathjax@2.7.9/MathJax.js`** — hardcoded by Quarto's revealjs format. This is the **only** external dependency in the decks (verified by grep: reveal.js, chalkboard, menu, simplemenu, excalidraw, tabset, fonts, and all images are already local under `docs/site_libs/` and `docs/assets/`, all with relative paths).
- MathJax (and its font files, fetched at render time) fails to load on networks that block/deprioritize jsdelivr (school firewalls, privacy extensions, regional outages) → students see raw `$\bar{x}$` source. On the author's machine jsdelivr works, so it "looks fine."
- Verified in a spike (`/tmp/opencode/math-spike`): Quarto 1.10 revealjs **ignores** `math: method: katex` and `math: url` — the format forces MathJax v2. But the pandoc template variable **`mathjaxurl` (set as YAML metadata) DOES override the CDN URL** in the reveal config. The reveal RevealMath plugin then loads MathJax from that URL at runtime and MathJax loads config/jax/fonts relative to its own location.

## The fix

### 1. NEW `assets/mathjax/` — vendored MathJax 2.7.9 (~7.8 MB, 641 files)
From the official npm `mathjax@2.7.9` tarball, keep only what `?config=TeX-AMS_HTML-full` + HTML-CSS output needs:
- `MathJax.js`, `config/TeX-AMS_HTML-full.js`
- `extensions/TeX/` (whole dir — lazy-loaded extensions live here)
- `jax/input/TeX/`, `jax/element/mml/`, `jax/output/HTML-CSS/` (incl. `autoload/`, `fonts/` JS data), `jax/output/PreviewHTML/`
- `fonts/HTML-CSS/TeX/{eot,otf,woff}` (drop `png/` image-font fallback)
- Drop: all other font families, `jax/output/{SVG,NativeMML,PlainSource,CommonHTML}`, other configs, `docs/`, `unpacked/`

### 2. `_quarto.yml`
Add `assets/mathjax/` to `project: resources:` (guarantees copy to `docs/assets/mathjax/`; `resources:` already used for `data/`, `_rmd_fa26/`).

### 3. `presentations/_metadata.yml`
Add:
```yaml
mathjaxurl: "../assets/mathjax/MathJax.js"
```
Relative path → works both hosted (monaxue.github.io) and from a downloaded `docs/` folder opened via `file://` (all deck paths are already relative, so the downloaded site works fully offline after this fix except live-poll features).

### 4. Re-render + verify
- `quarto render`
- `grep -rl jsdelivr docs/presentations/*.html` → empty (only static demo artifact `docs/presentations/assets/basic_example.html` may remain; out of scope unless requested)
- Browser check the math-heavy decks (week1, week4, week6, week7, week12, casestudychecklist): formulas render identically, devtools Network shows no 404s from `assets/mathjax/`
- Chalkboard, menu, simplemenu, polls unaffected (no structural change)

## On "embed everything possible into the HTML" — recommendation: NO
- `embed-resources: true` exists, but:
  1. Your own `_metadata.yml` comment documents that self-contained breaks the chalkboard.
  2. It cannot fix math anyway: MathJax is injected at **runtime** by the RevealMath plugin via `script.src = <url>` — pandoc/quarto never sees it as a static `<script src>` tag, so it can never inline it.
  3. 15 decks × multi-MB, duplicated libs, loses shared `site_libs` caching.
- Un-embeddable by nature: slido iframes (`wall.sli.do`), the `shiny.rit.albany.edu` iframe, Supabase polls — these are live external apps.
- After the fix, the practical goal is achieved the better way: if the site loads at all, math loads (same origin), and a downloaded copy of the site works offline for slides + math + images.

## Optional hardening — declined by user
- No CDN regression check script; no fix for `docs/presentations/assets/basic_example.html`.

## User decisions (final)
- Robust vendored set (~7.8 MB).
- No extras.
- Implementation only; user renders/verifies the decks themselves.

## Tradeoffs to flag
- Repo grows ~+7.8 MB (source `assets/mathjax/`) + ~7.8 MB (rendered `docs/assets/mathjax/`). Could trim to ~5 MB by dropping non-TeX font JS data from `jax/output/HTML-CSS/fonts/`, at slightly higher risk of a missing-file 404 for unusual constructs.
- MathJax 2.x is EOL, but vendoring removes the CDN exposure and guarantees byte-identical rendering; upgrading to MathJax 3/KaTeX would require patching the reveal config via a custom filter and re-verifying every deck (rejected for now).
