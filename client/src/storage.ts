import type { Ingredient, Recipe } from "./types";

const LIST_KEY = "grocery-scanner:list:v1";
const RECIPES_KEY = "grocery-scanner:recipes:v1";

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
