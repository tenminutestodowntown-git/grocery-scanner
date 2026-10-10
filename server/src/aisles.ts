// Canonical aisle list used for grouping the grocery list.
// Order here is the order the list is displayed in the app (a sensible walk through a typical store).
export const AISLES = [
  "Produce",
  "Bread & Grains",
  "Bulk Foods (Nuts, Spices, etc.)",
  "Dry Foods (Pasta, Rice, Legumes)",
  "Breakfast & Cereal",
  "Cooking Oils & Nut Butters",
  "Baking",
  "Canned Foods",
  "Condiments & Sauces",
  "Meat & Seafood",
  "Deli",
  "International Foods",
  "Frozen Foods",
  "Dairy",
  "Beverages",
  "Other",
] as const;

export type Aisle = (typeof AISLES)[number];

// Extra categorization hints for the newer aisles, shared by both vision prompts so the model
// uses them instead of falling back to "Canned Foods" or "Other" for these items.
export const AISLE_GUIDANCE = `  Use these aisles for the following kinds of items:
  - "Condiments & Sauces": ketchup, mustard, mayo, salad dressing, hot sauce, soy sauce, salsa (not "Canned Foods" or "Other").
  - "Breakfast & Cereal": cereal, oatmeal, granola, pancake mix, syrup.
  - "Deli": sliced deli meats and cheeses, prepared deli salads and sides. Fresh/raw meat (e.g. chicken breast,
    ground beef, steak) stays in "Meat & Seafood".
  - "Beverages": soda, juice, bottled water, coffee, tea.`;

export function isValidAisle(value: string): value is Aisle {
  return (AISLES as readonly string[]).includes(value);
}
