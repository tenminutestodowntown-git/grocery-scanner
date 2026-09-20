export const AISLES = [
  "Produce",
  "Bread & Grains",
  "Bulk Foods (Nuts, Spices, etc.)",
  "Dry Foods (Pasta, Rice, Legumes)",
  "Cooking Oils & Nut Butters",
  "Baking",
  "Canned Foods",
  "Meat & Seafood",
  "International Foods",
  "Frozen Foods",
  "Dairy",
  "Other",
] as const;

export type Aisle = (typeof AISLES)[number];

// What one specific recipe added to a merged line, kept so that recipe's contribution can
// be precisely subtracted back out later instead of guessing at how to "un-merge" a
// combined quantity.
export interface ContributionEntry {
  recipeName: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: Aisle;
  checked: boolean;
  sourceRecipes: string[];
  contributions: ContributionEntry[];
}

// The raw per-ingredient shape returned by the vision model, before it's merged into
// a running list (that merge step is what assigns an `id`, `checked`, `sourceRecipes`, etc).
export interface ParsedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: string;
}

export interface ScanResponse {
  recipeName: string;
  ingredients: ParsedIngredient[];
  list: Ingredient[];
}

export interface MergeResponse {
  list: Ingredient[];
}

// A saved scan: the photo + what was read from it, kept around so the extracted list can
// be shown alongside the photo, and so it can be starred as a favorite and re-added later
// without re-scanning.
export interface Recipe {
  id: string;
  name: string;
  photoDataUrl: string;
  ingredients: ParsedIngredient[];
  favorite: boolean;
  createdAt: number;
  cookbookName?: string;
  pageNumber?: string;
}

// The name used for the synthetic "recipe" a manually-typed ingredient is attributed to,
// so it flows through the same merge/contribution/remove machinery as a scanned recipe.
export const MANUAL_ENTRY_SOURCE = "Manually added";
