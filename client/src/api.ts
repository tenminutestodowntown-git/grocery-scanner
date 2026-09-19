import type { Ingredient, MergeResponse, ParsedIngredient, ScanResponse } from "./types";

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
