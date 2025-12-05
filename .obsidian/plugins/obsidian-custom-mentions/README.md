# Custom Mentions (Obsidian)

Trigger any symbol (e.g., `@`, `;`, `%`, `!`, `~`) to open a curated suggester for:
- Pages (with folder/tag filters)
- Commands (filter by id/name)
- Tags (whitelist/blacklist/contains)

Insert with a template that can wrap or expand the selection, including a `{{cursor}}` placeholder.

## Install

1. Unzip this into your vault: `.obsidian/plugins/obsidian-custom-mentions/`
2. In Obsidian → Settings → Community Plugins:
   - Turn **Safe Mode** off
   - Enable **Custom Mentions**
3. (Dev) Run `npm i` then `npm run dev` (watch) or `npm run build`

## Dev scripts

- `npm run dev` — esbuild watch with sourcemaps
- `npm run build` — minified production build
- `npm run check` — type-check only

## Notes

- Choose trigger symbols that don't clash with your typing.
- Uses core metadata; no Dataview dependency.
- Max results and fuzzy matching are configurable in settings.