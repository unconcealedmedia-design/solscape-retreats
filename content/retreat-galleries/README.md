# Retreat galleries

Photos taken *during* a past retreat, shown in the **Retreat Gallery** section
("Moments from …") on that retreat's archive page. These are separate from the
venue's property and room photos.

Each past retreat has one list here, named after its page:
`greece.json` → `src/pages/retreats/past/greece.astro`.

## Add photos to a retreat

1. Export each photo as `.webp`, about 1600px on the long edge (roughly 200–400 KB).
2. Name files in lowercase with hyphens, describing the moment:
   `sunrise-yoga-terrace.webp`, `long-table-dinner.webp`.
3. Put the files in `public/images/<retreat>/retreat-gallery/`
   (for Greece: `public/images/greece/retreat-gallery/`).
4. Add one entry per photo to `<retreat>.json`, in the order they should appear.
   With 3 or more photos, the first one becomes the large lead frame.

   ```json
   {
     "photos": [
       { "file": "sunrise-yoga-terrace.webp", "alt": "Morning yoga on the terrace above the Mani coast" },
       { "file": "long-table-dinner.webp", "alt": "The group sharing dinner at a long outdoor table at dusk" }
     ]
   }
   ```

   `alt` describes what the photo shows, for screen readers. Every photo needs one.
5. Run `npm run dev` and open the retreat page. The section appears as soon as the
   first photo is listed. While the list is empty it stays hidden on the live site;
   the dev server shows a placeholder where it will sit.

If an entry points to a missing file, has no alt text, or uses a name that isn't
lowercase-hyphenated, `npm run build` stops and names the entry to fix.

## Add the gallery to another past retreat

1. Create `<retreat>.json` here containing `{ "photos": [] }`, then add photos as above.
2. In `src/pages/retreats/past/<retreat>.astro`, import the component and place it
   directly after the Overview section. `place` finishes the heading
   ("Moments from the Mani" on the Greece page):

   ```astro
   import RetreatGallery from '../../../components/RetreatGallery.astro';

   <RetreatGallery retreat="greece" place="the Mani" />
   ```

No CSS or JavaScript changes are needed: the section, grid, and lightbox are shared.
