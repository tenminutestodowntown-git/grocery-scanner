import { AISLES } from "./types";
import type { Aisle, Ingredient, MergeResponse, ParsedIngredient, PantryScanResponse, ScanResponse } from "./types";

// Empty by default: requests go to the same origin the page was loaded from (works from
// any device on the network via the Vite dev server's /api proxy, see vite.config.ts).
// Set VITE_API_BASE only when the API is served from a different host than the page.
const API_BASE = import.meta.env.VITE_API_BASE || "";

export async function scanRecipePhoto(photo: Blob, currentList: Ingredient[]): Promise<ScanResponse> {
  const form = new FormData();
  form.append("photo", photo, "recipe.jpg");
  form.append("list", JSON.stringify(currentList));

  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** Sends one or more fridge/pantry photos and gets back the grocery items spotted across all
 * of them (deduplicated server-side). Doesn't touch the grocery list — purely a lookup. */
export async function scanPantryPhotos(photos: Blob[]): Promise<PantryScanResponse> {
  const form = new FormData();
  photos.forEach((photo, idx) => form.append("photos", photo, `pantry-${idx}.jpg`));

  const res = await fetch(`${API_BASE}/api/scan-pantry`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** Removes a recipe's contribution from the list, precisely un-merging any shared quantities. */
export async function removeRecipeFromList(recipeName: string, currentList: Ingredient[]): Promise<MergeResponse> {
  const res = await fetch(`${API_BASE}/api/remove-recipe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ list: currentList, recipeName }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** Re-adds a previously-scanned recipe's ingredients into the current list, no photo needed. */
export async function mergeRecipeIntoList(
  ingredients: ParsedIngredient[],
  recipeName: string,
  currentList: Ingredient[]
): Promise<MergeResponse> {
  const res = await fetch(`${API_BASE}/api/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ list: currentList, ingredients, recipeName }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** Asks the server for a best-guess aisle for a manually-typed item name. Gives up after a few
 * seconds so a slow network never leaves the add form waiting; callers fall back to "Other". */
export async function categorizeItemName(name: string): Promise<Aisle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}/api/categorize-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const body = (await res.json()) as { aisle?: string };
    return (AISLES as readonly string[]).includes(body.aisle ?? "") ? (body.aisle as Aisle) : "Other";
  } finally {
    clearTimeout(timer);
  }
}
