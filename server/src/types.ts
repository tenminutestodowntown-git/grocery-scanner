import type { Aisle } from "./aisles.js";

// What one specific recipe added to a merged line, kept so that recipe's contribution can
// be precisely subtracted back out later (see removeRecipeFromList in merge.ts) instead of
// guessing at how to "un-merge" a combined quantity.
export interface ContributionEntry {
  recipeName: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
}

// A single ingredient line as extracted from a photo, or as merged into the list.
export interface Ingredient {
  id: string;
  name: string; // canonical/display name, singular, capitalized naturally e.g. "Cucumber"
  quantity: number | null; // null when quantity is not expressible as a single number (e.g. "to taste")
  unit: string | null; // e.g. "cup", "tbsp", "g", "lb", null for count-based items (e.g. 2 cucumbers -> unit null, quantity 2)
  note: string | null; // free-text qualifier, e.g. "to taste", "diced", "ripe"
  aisle: Aisle;
  checked: boolean;
  sourceRecipes: string[]; // names/labels of recipes that contributed to this line (derived from contributions)
  contributions: ContributionEntry[]; // the per-recipe breakdown behind quantity/unit/note above
}

export interface ParsedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: string; // validated against AISLES before use
}

export interface ParseRecipeResponse {
  recipeName: string;
  ingredients: ParsedIngredient[];
}

// A single item spotted in a fridge/pantry photo. "confidence" is "low" when the model is
// guessing from shape/color/packaging alone (no readable label) rather than being sure.
export interface PantryItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string; // validated against AISLES before use
  confidence: "high" | "low";
}

export interface ParsePantryResponse {
  items: PantryItem[];
}
