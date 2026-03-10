# quarto-poll v2

Live audience polls for Quarto RevealJS with Supabase, countdown timers, free-response questions, and AI grading.

## What's new in v2

- **Countdown timer** — visible to everyone, synced via Supabase
- **Admin can set timer** before starting, and **adjust it live** while the poll is running
- **Free response questions** — `:::freeresponse:::` syntax
- **AI grading** — Claude categorises mistakes and shows % correct / partial / incorrect
- **Correct answer marking** — tag one or multiple MC options with `[correct]` to highlight them in results
- Both question types use the same DB tables

---

## Quick Start

### 1. Supabase setup

1. Create a free project at [supabase.com](https://supabase.com)
2. **SQL Editor** → run `supabase_schema.sql`
3. **Database → Replication** → enable `poll_sessions` for realtime (INSERT + UPDATE)
4. Copy your **Project URL** and **anon public key** from *Settings → API*

### 2. Install the extension

```
your-project/
├── _extensions/
│   └── poll/
│       ├── _extension.yml
│       ├── poll.js
│       └── poll.css
└── talk.qmd
```

### 3. Configure

```yaml
---
format:
  revealjs:
    include-in-header:
      text: |
        <script>
          window.POLL_SUPABASE_URL   = "https://xxx.supabase.co";
          window.POLL_SUPABASE_ANON  = "eyJ...";
          window.POLL_ADMIN_PASSWORD = "your-password";
          window.POLL_CLAUDE_API_KEY = "sk-ant-...";  // optional, for AI grading
          window.POLL_DEFAULT_TIMER  = 60;             // seconds, 0 = no timer
        </script>
revealjs-plugins:
  - poll
---
```

---

## Syntax

### Multiple choice

```markdown
::: poll
**Which framework do you prefer?**

- React
- Vue
- Svelte
:::
```

### Multiple choice with a correct answer

Add `[correct]` after any option. It is **stripped from the audience view** — they see no indication during voting. When results are revealed, correct options are highlighted in green.

```markdown
::: poll
**What is the powerhouse of the cell?**

- Nucleus
- Mitochondria [correct]
- Ribosome
- Golgi apparatus
:::
```

### Multiple choice with multiple correct answers

```markdown
::: poll
**Which of these are measures of central tendency?**

- Mean [correct]
- Variance
- Median [correct]
- Standard deviation
- Mode [correct]
:::
```

### Multiple choice with custom timer

```markdown
::: {.poll data-timer="30"}
**Quick question — 30 seconds only!**

- Option A
- Option B
:::
```

### Free response with AI grading

```markdown
::: freeresponse
**What is the Central Limit Theorem?**

[answer: As sample size increases, the sampling distribution of the mean approaches normal]
:::
```

The `[answer: ...]` line is **invisible to the audience** — it's stripped from the rendered HTML.  
When the poll closes, Claude analyses all responses and shows:
- **% correct / partial / incorrect** (semantic, not literal matching)
- **Mistake taxonomy** — grouped categories with examples and explanations
- **One-line insight** for the presenter

### Free response with no correct answer (open-ended)

```markdown
::: {.freeresponse data-timer="45"}
**What's your biggest challenge with data visualisation?**
:::
```

Without `[answer: ...]`, the AI will skip scoring and just categorise themes.

---

## Timer behaviour

| Scenario | Behaviour |
|----------|-----------|
| Admin sets timer before starting | Audience sees the countdown from start |
| Admin clicks **−10s / +10s** during poll | All audience timers update in real-time |
| Admin clicks **∞** | Timer disappears for everyone |
| Timer hits 0 | Poll closes automatically for everyone |
| Admin clicks ⏹ Close before timer | Poll closes immediately |

---

## Admin workflow

1. Click the faint 🎙 button in the **bottom-right corner**
2. Enter the presenter password → green ring confirms admin mode
3. On each poll slide you see:
   - **Timer stepper** — set duration before or during the poll
   - **▶ Start** — opens the poll for audience
   - **⏹ Close** — closes and triggers results
   - **🤖 Analyse** *(free response only)* — re-run AI analysis on demand
4. Vote count refreshes every 3 seconds while open

---

## Database schema

| Table | Columns |
|-------|---------|
| `poll_sessions` | `poll_id`, `status`, `poll_type`, `question`, `options`, `correct_answer`, `correct_indices`, `timer_secs`, `timer_end` |
| `poll_votes` | `poll_id`, `voter_name`, `option_index` (MC), `response_text` (free) |

Unique constraint on `(poll_id, voter_name)` prevents duplicate votes.

---

## Upgrading from v1

Run the migration block at the bottom of `supabase_schema.sql`:

```sql
alter table poll_sessions add column if not exists poll_type       text default 'mc';
alter table poll_sessions add column if not exists correct_answer  text;
alter table poll_sessions add column if not exists correct_indices text;
alter table poll_sessions add column if not exists timer_secs      integer default 0;
alter table poll_sessions add column if not exists timer_end       timestamptz;
alter table poll_votes    add column if not exists option_index    integer;
alter table poll_votes    add column if not exists response_text   text;
```

---

## Security notes

- The **admin password is client-side only** — it's a convenience guard, not a hard security boundary
- **Correct answers for MC polls are stored in Supabase** after the poll opens, so a determined user could query them. Don't use this for graded assessments requiring answer secrecy
- The **Claude API key is exposed in the browser**. If you need to protect it, proxy the request through a Supabase Edge Function

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Audience doesn't see poll open | Enable `poll_sessions` realtime in Supabase dashboard |
| Timer doesn't update live | Same — realtime must be enabled |
| AI analysis fails silently | Check browser console; verify `POLL_CLAUDE_API_KEY` is set correctly |
| Votes not saving | Check RLS policies allow INSERT on `poll_votes` |
| `[correct]` not highlighting in results | Run the migration SQL to add the `correct_indices` column |
| "Missing Supabase credentials" | Verify the `<script>` block is inside `include-in-header` |
