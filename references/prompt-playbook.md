# SolScape — Prompt Playbook

> How to talk to Claude Code so changes stay structured, on-brand, and easy. The whole point:
> the heavy context already lives in your files, so each prompt stays short and never
> re-explains the brand.

## The prompt block (your daily driver)

Every change follows this five-line shape:

```
GOAL:      <one section / one outcome>
USE:       frontend-design skill + references/design-system.md
KEEP:      <what must not change — usually: all copy, the IA, booking links>
ELEVATE:   <the specific craft move — sense of place, slow motion, type>
DONE WHEN: <acceptance — on-brand + reads on mobile + matches brand.md>
```

Example:

```
GOAL:      Elevate the Greece retreat card on the homepage.
USE:       frontend-design skill + references/design-system.md
KEEP:      All copy, the dates, the "Retreat details →" link.
ELEVATE:   Sense of place + the slow breathing scroll-in motion.
DONE WHEN: It feels editorial, works at 375px, and matches brand.md.
```

## Ready-to-paste edits (everyday content)

- **Archive a retreat:** "Make the Greece retreat a past retreat." *(flips `status` to `past`;
  it moves itself into the Past section — nothing else changes.)*
- **Add a retreat:** "Add a new upcoming retreat: country, place, dates, one-word motif,
  activities, and this summary: …" *(creates a new file in `content/retreats/`.)*
- **Swap photos:** "I've dropped new photos in `images/retreats/greece/`. Wire them into the
  Greece gallery and pick the strongest one as the hero."
- **Edit copy:** "Update Nada's bio in `content/founders.md` to: …"
- **Fix something:** "Run the design-audit skill on about.html and fix what it finds."

## The migration sequence (current HTML → Astro + CMS)

Do these **in order, one prompt at a time.** Preview and approve each before the next — small
steps keep Claude Code accurate and keep your usage efficient.

1. **Set the manual.** "Replace the project CLAUDE.md with the SolScape one I'm providing, and
   add `references/brand.md` and `references/design-system.md`." *(The old CLAUDE.md is for a
   Trigger.dev automation project — it must go.)*

2. **Scaffold Astro.** "Initialize an Astro static site in this repo without deleting my
   existing HTML/CSS/JS. Keep Cormorant Garamond + Jost and my current styles."

3. **Extract real tokens.** "Read `css/styles.css` `:root` and fill the exact color values into
   `references/design-system.md`."

4. **Componentize the shell.** "Turn the nav and footer into single reusable Astro components
   and use them on every page. Remove the copy-pasted duplicates."

5. **Build the retreat collection.** "Create an Astro content collection for retreats using the
   schema in CLAUDE.md (including the `status: upcoming|past` field). Migrate the existing
   retreat pages into `content/retreats/` files."

6. **Drive the listings from content.** "Make the homepage render Upcoming and Past retreats
   automatically from the collection, sorted by the `status` field."

7. **Move site + founder copy into content.** "Create `content/site.md` and
   `content/founders.md` and wire the templates to read from them."

8. **Fix the known bugs.** "Run design-audit across all pages. Fix the curly-quote attributes
   in about.html (Philosophy paragraphs + the entire Nada card) and standardize the retreat
   one-word motifs (lowercase; replace the 'SoFen' placeholder)."

9. **Add the CMS.** "Add Sveltia CMS at `/admin` with a config matching my content collections —
   retreats (with a status dropdown and drag-drop image fields), site copy, and founders. Use
   the current recommended auth; do NOT use the deprecated Netlify Identity."

10. **Ship.** "Confirm `npm run build` passes, then walk me through deploying on Netlify."

## Discipline that keeps it well-made

One section per prompt. Audit before you ship. Log every real decision in `decisions/log.md`.
No "redo the whole site" prompts — that's exactly where it drifts generic.
