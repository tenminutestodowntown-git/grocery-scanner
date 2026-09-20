import { randomUUID } from "node:crypto";
import { isValidAisle } from "./aisles.js";
import type { ContributionEntry, Ingredient, ParsedIngredient } from "./types.js";
import { combineQuantities, normalizeUnit } from "./units.js";

// A small alias table so common synonyms match each other (extend as needed).
const NAME_ALIASES: Record<string, string> = {
  scallion: "green onion",
  scallions: "green onion",
  "spring onion": "green onion",
  "spring onions": "green onion",
  cilantro: "coriander",
  garbanzo: "chickpea",
  "garbanzo bean": "chickpea",
  "garbanzo beans": "chickpea",
  courgette: "zucchini",
  aubergine: "eggplant",
  capsicum: "bell pepper",
  // Note: onion color/type variants (yellow, white, red, sweet, etc.) are deliberately
  // NOT aliased to a generic "onion" here — those are kept as their own distinct list
  // lines on purpose, since they're genuinely different things to buy. Two mentions of
  // the *same* variety (e.g. "Yellow onion" and "yellow onions" from different recipes)
  // still combine correctly via the lowercase + singularize normalization below.
};

function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return word.slice(0, -3) + "y";
  if (word.endsWith("oes") && word.length > 3) return word.slice(0, -2); // tomatoes -> tomato
  if (word.endsWith("ses")) return word.slice(0, -2); // molasses stays molasse-ish edge case, acceptable
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Normalize a name to a matching key: lowercase, singular, alias-resolved. */
export function nameKey(name: string): string {
  const lower = name.trim().toLowerCase();
  const singular = singularize(lower);
  return NAME_ALIASES[lower] ?? NAME_ALIASES[singular] ?? singular;
}

/** Combines a list of per-recipe contributions (already known to have mutually compatible
 * units, since incompatible ones are kept as separate list lines — see mergeIngredients)
 * into the single quantity/unit/note a list line should display. */
function foldContributions(contributions: ContributionEntry[]): { quantity: number | null; unit: string | null; note: string | null } {
  let quantity = contributions[0]?.quantity ?? null;
  let unit = contributions[0]?.unit ?? null;

  for (const c of contributions.slice(1)) {
    const combined = combineQuantities(quantity, unit, c.quantity, c.unit);
    if (combined) {
      quantity = combined.quantity;
      unit = combined.unit;
    }
    // If somehow incompatible at fold time (shouldn't happen — see note above), keep the
    // running total rather than losing it; this is a defensive fallback only.
  }

  const notes = [...new Set(contributions.map((c) => c.note).filter((n): n is string => !!n))];
  const note = notes.length > 0 ? notes.join("; ") : null;

  return { quantity, unit, note };
}

export function toIngredient(parsed: ParsedIngredient, recipeName: string): Ingredient {
  const quantity = parsed.quantity;
  const unit = normalizeUnit(parsed.unit);
  const note = parsed.note?.trim() || null;

  return {
    id: randomUUID(),
    name: parsed.name.trim(),
    quantity,
    unit,
    note,
    aisle: isValidAisle(parsed.aisle) ? parsed.aisle : "Other",
    checked: false,
    sourceRecipes: [recipeName],
    contributions: [{ recipeName, quantity, unit, note }],
  };
}

/**
 * Merge a freshly-parsed recipe's ingredients into an existing grocery list.
 * Matching items (by normalized name) have their quantities combined when the
 * units are compatible; otherwise a new line is added so nothing is silently lost.
 */
export function mergeIngredients(
  existing: Ingredient[],
  incoming: ParsedIngredient[],
  recipeName: string
): Ingredient[] {
  const result = existing.map((item) => ({
    ...item,
    sourceRecipes: [...item.sourceRecipes],
    contributions: item.contributions ? [...item.contributions] : [{ recipeName: item.sourceRecipes[0] ?? "Unknown", quantity: item.quantity, unit: item.unit, note: item.note }],
  }));

  for (const parsed of incoming) {
    const newItem = toIngredient(parsed, recipeName);
    const key = nameKey(newItem.name);

    const match = result.find((item) => nameKey(item.name) === key);

    if (!match) {
      result.push(newItem);
      continue;
    }

    const combined = combineQuantities(match.quantity, match.unit, newItem.quantity, newItem.unit);

    if (combined) {
      match.quantity = combined.quantity;
      match.unit = combined.unit;
      match.contributions.push(...newItem.contributions);
      if (!match.sourceRecipes.includes(recipeName)) match.sourceRecipes.push(recipeName);
      // Merge notes if the new one adds information not already present.
      if (newItem.note && (!match.note || !match.note.includes(newItem.note))) {
        match.note = match.note ? `${match.note}; ${newItem.note}` : newItem.note;
      }
    } else {
      // Units incompatible (e.g. "2 cups flour" vs "200g flour") — keep as a distinct line
      // rather than guessing, but tag it clearly so the user can reconcile by eye.
      result.push(newItem);
    }
  }

  return result;
}

/**
 * Removes a recipe's contribution from the list. For lines that came only from this recipe,
 * the whole line is dropped. For lines shared with other recipes, this recipe's contribution
 * is precisely subtracted back out and the remaining recipes' amounts are re-combined — so
 * "2 cucumbers" (1 from each of two recipes) correctly becomes "1 cucumber" rather than
 * disappearing or being left wrong.
 */
export function removeRecipeFromList(list: Ingredient[], recipeName: string): Ingredient[] {
  const result: Ingredient[] = [];

  for (const item of list) {
    const contributions = item.contributions ?? [{ recipeName: item.sourceRecipes[0] ?? "Unknown", quantity: item.quantity, unit: item.unit, note: item.note }];
    const remaining = contributions.filter((c) => c.recipeName !== recipeName);

    if (remaining.length === 0) {
      // This line existed only because of the recipe being removed — drop it entirely.
      continue;
    }

    if (remaining.length === contributions.length) {
      // This recipe never contributed to this line — keep it untouched.
      result.push(item);
      continue;
    }

    const folded = foldContributions(remaining);
    result.push({
      ...item,
      quantity: folded.quantity,
      unit: folded.unit,
      note: folded.note,
      contributions: remaining,
      sourceRecipes: [...new Set(remaining.map((c) => c.recipeName))],
    });
  }

  return result;
}
