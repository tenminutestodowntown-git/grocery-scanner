// Minimal unit-conversion support so quantities can be summed across recipes
// when they use different (but compatible) units.

type UnitFamily = "volume" | "weight" | "count";

interface UnitInfo {
  family: UnitFamily;
  toBase: number; // multiplier to convert 1 of this unit into the family's base unit
}

// Base units: volume -> ml, weight -> g
const UNIT_TABLE: Record<string, UnitInfo> = {
  ml: { family: "volume", toBase: 1 },
  l: { family: "volume", toBase: 1000 },
  tsp: { family: "volume", toBase: 4.92892 },
  tbsp: { family: "volume", toBase: 14.7868 },
  "fl oz": { family: "volume", toBase: 29.5735 },
  cup: { family: "volume", toBase: 236.588 },
  pint: { family: "volume", toBase: 473.176 },
  quart: { family: "volume", toBase: 946.353 },
  gallon: { family: "volume", toBase: 3785.41 },
  g: { family: "weight", toBase: 1 },
  kg: { family: "weight", toBase: 1000 },
  oz: { family: "weight", toBase: 28.3495 },
  lb: { family: "weight", toBase: 453.592 },
};

export function normalizeUnit(unit: string | null): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  const aliases: Record<string, string> = {
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    cups: "cup",
    ounce: "oz",
    ounces: "oz",
    pound: "lb",
    pounds: "lb",
    lbs: "lb",
    gram: "g",
    grams: "g",
    kilogram: "kg",
    kilograms: "kg",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    milliliter: "ml",
    milliliters: "ml",
    millilitre: "ml",
    millilitres: "ml",
    "fl. oz": "fl oz",
    "fluid ounce": "fl oz",
    "fluid ounces": "fl oz",
    pints: "pint",
    quarts: "quart",
    gallons: "gallon",
  };
  return aliases[u] ?? u;
}

export function unitFamily(unit: string | null): UnitFamily {
  if (!unit) return "count";
  const norm = normalizeUnit(unit);
  return norm && UNIT_TABLE[norm] ? UNIT_TABLE[norm].family : "count";
}

/**
 * Try to combine two (quantity, unit) pairs into one. Returns null if the units
 * are incompatible (different families, or unknown units that don't match exactly),
 * meaning the caller should keep them as separate lines instead.
 */
export function combineQuantities(
  aQty: number | null,
  aUnit: string | null,
  bQty: number | null,
  bUnit: string | null
): { quantity: number | null; unit: string | null } | null {
  const normA = normalizeUnit(aUnit);
  const normB = normalizeUnit(bUnit);

  // Both count-based (no unit) -> just add quantities (or null if either is null-qty with no unit info).
  if (!normA && !normB) {
    if (aQty === null && bQty === null) return { quantity: null, unit: null };
    if (aQty === null) return { quantity: bQty, unit: null };
    if (bQty === null) return { quantity: aQty, unit: null };
    return { quantity: aQty + bQty, unit: null };
  }

  // One has a unit and the other doesn't (e.g. "2" vs "1 cup") -> can't merge quantities meaningfully.
  if (!normA || !normB) return null;

  const infoA = UNIT_TABLE[normA];
  const infoB = UNIT_TABLE[normB];

  // Same exact unit string, even if unrecognized -> just add.
  if (normA === normB) {
    if (aQty === null || bQty === null) return null;
    return { quantity: aQty + bQty, unit: normA };
  }

  // Different units, both recognized and same family -> convert to base, sum, convert back to the larger unit's precision.
  if (infoA && infoB && infoA.family === infoB.family && aQty !== null && bQty !== null) {
    const totalBase = aQty * infoA.toBase + bQty * infoB.toBase;
    // Display in whichever of the two units is "larger" (bigger toBase), rounded sensibly.
    const displayUnit = infoA.toBase >= infoB.toBase ? normA : normB;
    const displayInfo = UNIT_TABLE[displayUnit];
    const displayQty = Math.round((totalBase / displayInfo.toBase) * 100) / 100;
    return { quantity: displayQty, unit: displayUnit };
  }

  // Incompatible families (e.g. cup vs g) -> caller should keep as separate lines.
  return null;
}
