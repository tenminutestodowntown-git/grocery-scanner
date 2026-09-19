# Grocery Scanner

Snap a photo of a cookbook recipe's ingredient list; the app reads it with Claude's vision
model, sorts everything into grocery-store aisles, and merges it into one running list —
combining quantities across recipes (e.g. "1 cucumber" + "1 cucumber" → "2 cucumbers") so you
never end up with duplicate lines. Check items off as you shop, and share or download the list
so it's on your phone (e.g. pasted into Notes/Reminders) even without the app open.

Every scanned photo is kept as a "recipe" card — you can see the photo alongside the exact
ingredients that were pulled from it, star ones you make often as favorites, and hit "Add to
list" to merge a favorite back into your current list any time without rescanning it. Changed
your mind about a recipe? Its card switches to "Remove from list", which precisely un-merges
just that recipe's contribution — so if two recipes both needed a cucumber and you remove one,
you're correctly left with one cucumber, not zero.

## Structure

- `server/` — Express API. One endpoint, `POST /api/scan`, takes a photo + the current list and
  returns the merged list, using Claude's vision API to read the photo.
- `client/` — React + Vite PWA. Mobile-first UI: take/upload a photo, see the aisle-grouped
  checklist, check things off, share/export.

## Running it locally

### 1. Backend

```
cd server
cp .env.example .env   # then put your real Anthropic API key in .env
npm install             # already done if you're picking this up fresh
npm run dev
```

This starts the API on http://localhost:3001. You need an Anthropic API key
(https://console.anthropic.com/) in `server/.env` as `ANTHROPIC_API_KEY`.

### 2. Frontend

```
cd client
npm run dev
```

This starts the app on http://localhost:5173, listening on your whole network (not just
localhost), and Vite prints a second "Network:" URL like `http://192.168.1.23:5173` — open
that one on your phone (same wifi network as your computer) to test the camera capture flow,
or use `http://localhost:5173` in a desktop browser with file upload.

The frontend talks to the backend over the *same* origin/port it was loaded from (Vite proxies
`/api` requests to `http://localhost:3001` for you — see `client/vite.config.ts`), so the
"Network" URL works from your phone with no extra configuration. Only set `VITE_API_BASE` (in
`client/.env`, copied from `client/.env.example`) if the API ever lives on a different host,
e.g. once deployed.

## Installing to your phone's home screen (PWA)

Once both are running and reachable from your phone's browser:
- **iPhone (Safari):** open the site → Share → "Add to Home Screen"
- **Android (Chrome):** open the site → menu (⋮) → "Add to Home screen" / "Install app"

It'll behave like a real app icon — full screen, no browser chrome.

## Deploying so it works away from your home network

Right now both parts assume `localhost`. To actually use this day-to-day (e.g. from the grocery
store), you'd deploy:
- `server/` to something like Railway, Render, or Fly.io (needs the `ANTHROPIC_API_KEY` env var set)
- `client/` to Vercel, Netlify, or Cloudflare Pages, with `VITE_API_BASE` pointing at the deployed
  backend URL

Happy to help set either of those up when you're ready.

## How the aisle grouping works

Aisles (in shopping order): Produce, Bread & Grains, Bulk Foods, Dry Foods, Cooking Oils & Nut
Butters, Baking, Canned Foods, Meat & Seafood, International Foods, Frozen Foods, Dairy, Other.
Claude's vision model assigns each ingredient to one of these when it reads a photo
(`server/src/parseRecipe.ts`).

## How duplicate merging works

`server/src/merge.ts` matches ingredients by a normalized name (lowercased, singularized, common
synonyms like "scallion"/"green onion" resolved — see `NAME_ALIASES`). When two matching
ingredients have compatible units, their quantities are summed (`server/src/units.ts` handles
unit conversion, e.g. combining tbsp + cup). When units are incompatible (e.g. "2 cups flour" +
"200g flour"), both lines are kept so nothing is silently lost or guessed at — you reconcile
those by eye.

Each merged line remembers exactly what every contributing recipe added to it (see
`ContributionEntry` in `server/src/types.ts`). Removing a recipe (`removeRecipeFromList` in
`server/src/merge.ts`) subtracts just its contributions back out and re-folds whatever's left,
rather than deleting the line or leaving the quantity wrong.

One limitation worth knowing: recipes are matched by name, so two different recipes saved under
the exact same name (e.g. you scan two separate things both called "Pancakes") would be treated
as one when adding/removing from the list. Rename one if that ever comes up.

## Ideas for later

- Manual add/edit of a line (fix a misread ingredient without rescanning)
- Editable quantities in the UI
- Multiple saved lists (e.g. "this week" vs "meal prep")
- True native export to Apple Reminders/Google Keep via their share-sheet integrations
- Wrapping this as a real iOS/Android app (Capacitor) once the web version feels right
