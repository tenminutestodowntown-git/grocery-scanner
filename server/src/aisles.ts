// Canonical aisle list used for grouping the grocery list.
// Order here is the order the list is displayed in the app (a sensible walk through a typical store).
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

export function isValidAisle(value: string): value is Aisle {
  return (AISLES as readonly string[]).includes(value);
}
