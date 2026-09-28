import type { Ingredient, KitchenItem, PantryPhoto, Recipe } from "./types";

const LIST_KEY = "grocery-scanner:list:v1";
const RECIPES_KEY = "grocery-scanner:recipes:v1";
const KITCHEN_KEY = "grocery-scanner:kitchen:v1";
const PANTRY_PHOTOS_KEY = "grocery-scanner:pantryPhotos:v1";

export function loadList(): Ingredient[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveList(list: Ingredient[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable — fail silently, list still works in-memory for this session.
  }
}

export function loadRecipes(): Recipe[] {
  try {
    const raw = localStorage.getItem(RECIPES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRecipes(recipes: Recipe[]): void {
  try {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  } catch {
    // Most likely the storage quota was hit (photos add up) — the newest recipe still
    // works for the current session, it just won't survive a reload.
  }
}

export function loadKitchen(): KitchenItem[] {
  try {
    const raw = localStorage.getItem(KITCHEN_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveKitchen(kitchen: KitchenItem[]): void {
  try {
    localStorage.setItem(KITCHEN_KEY, JSON.stringify(kitchen));
  } catch {
    // Storage full or unavailable — fail silently, still works in-memory for this session.
  }
}

export function loadPantryPhotos(): PantryPhoto[] {
  try {
    const raw = localStorage.getItem(PANTRY_PHOTOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function savePantryPhotos(photos: PantryPhoto[]): void {
  try {
    localStorage.setItem(PANTRY_PHOTOS_KEY, JSON.stringify(photos));
  } catch {
    // Storage full (photos add up fast) — fail silently; they still work for this session,
    // they just won't survive a reload.
  }
}
