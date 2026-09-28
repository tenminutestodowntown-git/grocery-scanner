import { useEffect, useRef, useState } from "react";
import "./App.css";
import { AISLES, MANUAL_ENTRY_SOURCE, RAN_OUT_SOURCE } from "./types";
import type { Aisle, Ingredient, KitchenItem, PantryPhoto, Recipe } from "./types";
import {
  loadList,
  saveList,
  loadRecipes,
  saveRecipes,
  loadKitchen,
  saveKitchen,
  loadPantryPhotos,
  savePantryPhotos,
} from "./storage";
import {
  scanRecipePhoto,
  scanPantryPhotos,
  mergeRecipeIntoList,
  removeRecipeFromList as removeRecipeFromListApi,
} from "./api";
import { shareOrCopyList, downloadListAsText } from "./export";
import { resizeImage, dataUrlToBlob } from "./image";

type Status =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "done"; recipeName: string; cookbookName?: string | null; pageNumber?: string | null };
type RecipeFilter = "all" | "favorites";
type View = "home" | "list" | "recipes" | "kitchen" | "kitchenScan" | "kitchenReview";

function formatQuantity(item: { quantity: number | null; unit: string | null }): string {
  const parts: string[] = [];
  if (item.quantity !== null) parts.push(String(item.quantity));
  if (item.unit) parts.push(item.unit);
  return parts.join(" ");
}

// The grocery list view just needs "how many to grab" — the unit (cups, oz, etc.) is dropped
// there since it isn't useful while shopping and was cluttering the line. Recipe cards still
// use formatQuantity() above so the original extracted amounts stay visible for reference.
function formatListQuantity(item: { quantity: number | null }): string {
  return item.quantity !== null ? String(item.quantity) : "";
}

// A looser, client-side name match (vs. the server's fuller nameKey) used only for two
// lightweight lookups: flagging a grocery-list item that's already in My Kitchen, and
// avoiding duplicate My Kitchen entries when the same item gets added twice.
function simpleNameKey(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

// Words that name a "type" of meat/seafood cut broadly enough that two differently-named
// items sharing one (e.g. "Chuck roast" and "Pot roast") are very likely the same purchase
// for two different recipes, not two genuinely different things to buy. Deliberately scoped
// to the Meat & Seafood aisle only and to bigger-ticket items — a shared "1 onion" across two
// recipes already just merges into one list line, so this is only for the case where the
// vision model (correctly) kept two different-sounding cuts as separate lines.
const MEAT_TYPE_WORDS = [
  "roast",
  "chicken",
  "steak",
  "salmon",
  "shrimp",
  "pork",
  "turkey",
  "brisket",
  "ribs",
  "beef",
  "fish",
  "bacon",
  "sausage",
  "ham",
  "lamb",
  "tenderloin",
  "cod",
  "tilapia",
  "tuna",
];

function meatKeyword(name: string): string | null {
  const lower = name.toLowerCase();
  for (const w of MEAT_TYPE_WORDS) {
    if (lower.includes(w)) return w;
  }
  return null;
}

/** Finds the first pair of Meat & Seafood list lines (not already dismissed) that come from
 * different recipes but share the same broad "type" keyword — a likely case of the same cut
 * getting bought twice because two recipes named it slightly differently. Returns at most one
 * candidate at a time so only one prompt shows on screen at once. */
function findMeatDuplicateCandidate(
  items: Ingredient[],
  dismissed: Set<string>
): { a: Ingredient; b: Ingredient; keyword: string; pairKey: string } | null {
  const meatItems = items.filter((i) => i.aisle === "Meat & Seafood");
  for (let i = 0; i < meatItems.length; i++) {
    for (let j = i + 1; j < meatItems.length; j++) {
      const a = meatItems[i];
      const b = meatItems[j];
      if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) continue; // already the same line
      const kwA = meatKeyword(a.name);
      const kwB = meatKeyword(b.name);
      if (kwA && kwA === kwB) {
        const pairKey = [a.id, b.id].sort().join("::");
        if (!dismissed.has(pairKey)) return { a, b, keyword: kwA, pairKey };
      }
    }
  }
  return null;
}

/** Folds two distinct list lines into one — used when the user says two differently-named
 * meat/seafood items are really the same purchase shared across recipes. Sums the quantity
 * only when the units already match (rather than guessing at a conversion); otherwise keeps
 * the first line's amount and notes the second's name so nothing is silently lost. */
function combineTwoIngredients(a: Ingredient, b: Ingredient): Ingredient {
  const sameUnit = a.unit === b.unit;
  const quantity = sameUnit && a.quantity !== null && b.quantity !== null ? a.quantity + b.quantity : a.quantity ?? b.quantity;
  const unit = sameUnit ? a.unit : a.unit ?? b.unit;
  const noteBits = [a.note, b.note !== a.note ? `also "${b.name}"` : null].filter((n): n is string => !!n);
  return {
    ...a,
    quantity,
    unit,
    note: noteBits.length > 0 ? noteBits.join("; ") : null,
    sourceRecipes: Array.from(new Set([...a.sourceRecipes, ...b.sourceRecipes])),
    contributions: [...a.contributions, ...b.contributions],
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// --- inline icons, matching the wireframe's stroke-icon style ---
function IconCart({ color = "#3f8f7f" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h2l1.5 9.5A2 2 0 0 0 8.5 17h8a2 2 0 0 0 2-1.7L20 8H6" />
      <circle cx="9" cy="20" r="1.3" fill={color} stroke="none" />
      <circle cx="17" cy="20" r="1.3" fill={color} stroke="none" />
    </svg>
  );
}
function IconBook({ color = "#4a4a4a" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}
function IconStar({ color = "#4a4a4a", filled = false }: { color?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill={filled ? color : "none"} stroke={color} strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.9 6.4 20.1l1.4-6.3-4.8-4.3 6.4-.6L12 3z" />
    </svg>
  );
}
function IconChevronRight({ color = "#c7c7cc" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function IconChevronUp({ color = "#9a9a9a" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
function IconCamera({ color = "#3f8f7f" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="14" r="3.2" />
    </svg>
  );
}
function IconNote({ color = "#c7c7cc" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3M8.5 12h7M8.5 15.5h7M8.5 8.5h4" />
    </svg>
  );
}
function IconReminder({ color = "#c7c7cc" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.6">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  );
}
function IconFridge({ color = "#3f8f7f" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2.5" width="14" height="19" rx="2.2" />
      <line x1="5" y1="9.5" x2="19" y2="9.5" />
      <line x1="8" y1="5" x2="8" y2="7.3" />
      <line x1="8" y1="12" x2="8" y2="14.3" />
    </svg>
  );
}
function IconTip({ color = "#3f8f7f" }: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z" />
    </svg>
  );
}

export default function App() {
  const [list, setList] = useState<Ingredient[]>(() => loadList());
  const [recipes, setRecipes] = useState<Recipe[]>(() => loadRecipes());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [recipeFilter, setRecipeFilter] = useState<RecipeFilter>("all");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recipeChips, setRecipeChips] = useState<Set<string>>(new Set());
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [manualAisle, setManualAisle] = useState<Aisle>(AISLES[0]);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const dragging = useRef(false);
  const [kitchen, setKitchen] = useState<KitchenItem[]>(() => loadKitchen());
  const [pantryPhotos, setPantryPhotos] = useState<PantryPhoto[]>(() => loadPantryPhotos());
  const [pantryReview, setPantryReview] = useState<KitchenItem[]>([]);
  const pantryFileInputRef = useRef<HTMLInputElement>(null);
  const [addKitchenItemOpen, setAddKitchenItemOpen] = useState(false);
  const [manualKitchenName, setManualKitchenName] = useState("");
  const [manualKitchenQty, setManualKitchenQty] = useState("");
  const [manualKitchenUnit, setManualKitchenUnit] = useState("");
  const [manualKitchenAisle, setManualKitchenAisle] = useState<Aisle>(AISLES[0]);
  // Inline-edit drafts: while non-null, the matching row renders editable inputs instead of
  // static text. Kept as a single draft object (not per-row state) since only one row is
  // ever edited at a time.
  const [listEditDraft, setListEditDraft] = useState<{ id: string; name: string; qty: string; unit: string } | null>(null);
  const [kitchenEditDraft, setKitchenEditDraft] = useState<{
    id: string;
    name: string;
    qty: string;
    unit: string;
    aisle: Aisle;
  } | null>(null);
  // Pairs of Meat & Seafood items (from different recipes) the user has already told us they
  // want to buy separately — remembered per session so the same prompt doesn't nag them again
  // right after they answer it once.
  const [dismissedMeatPairs, setDismissedMeatPairs] = useState<Set<string>>(new Set());
  // Checking an item off doesn't remove it right away — it's marked checked and given a
  // 10s grace window (in case the tap was accidental) before it's actually dropped from the
  // list and tracked into My Kitchen. Unchecking within that window just undoes the check
  // as if nothing happened. Timers live in a ref (not state) since they're not rendered;
  // pendingRemovalIds is what drives the "removing in 10s" UI.
  const pendingRemovalTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(new Set());
  const listRef = useRef(list);

  useEffect(() => {
    saveList(list);
    listRef.current = list;
  }, [list]);

  // Cancel any pending 10s removals if the app unmounts, so they can't fire against
  // state that no longer exists.
  useEffect(() => {
    return () => {
      pendingRemovalTimers.current.forEach((t) => clearTimeout(t));
      pendingRemovalTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    saveRecipes(recipes);
  }, [recipes]);

  useEffect(() => {
    saveKitchen(kitchen);
  }, [kitchen]);

  useEffect(() => {
    savePantryPhotos(pantryPhotos);
  }, [pantryPhotos]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleFileChosen(file: File) {
    setStatus({ kind: "scanning" });
    try {
      const { blob, dataUrl } = await resizeImage(file);
      const result = await scanRecipePhoto(blob, list);
      setList(result.list);

      const recipe: Recipe = {
        id: newId(),
        name: result.recipeName,
        photoDataUrl: dataUrl,
        ingredients: result.ingredients,
        favorite: false,
        createdAt: Date.now(),
        cookbookName: result.cookbookName ?? undefined,
        pageNumber: result.pageNumber ?? undefined,
      };
      setRecipes((prev) => [recipe, ...prev]);

      setStatus({ kind: "done", recipeName: result.recipeName, cookbookName: result.cookbookName, pageNumber: result.pageNumber });
      setView("list");
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileChosen(file);
    e.target.value = ""; // allow choosing the same file again later
  }

  function openScanner() {
    fileInputRef.current?.click();
  }

  function toggleChecked(id: string) {
    const target = list.find((item) => item.id === id);
    if (!target) return;

    if (!target.checked) {
      // Check it off right away for visual feedback, but hold off 10s before actually
      // dropping it from the list and tracking it into My Kitchen — long enough to catch
      // an accidental tap without the item just vanishing under your thumb.
      setList((prev) => prev.map((item) => (item.id === id ? { ...item, checked: true } : item)));
      setPendingRemovalIds((prev) => new Set(prev).add(id));

      const timer = setTimeout(() => {
        pendingRemovalTimers.current.delete(id);
        setPendingRemovalIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        const stillChecked = listRef.current.find((item) => item.id === id);
        if (!stillChecked) return; // already removed some other way
        addToKitchenFromItem(stillChecked);
        setList((prev) => prev.filter((item) => item.id !== id));
      }, 10000);
      pendingRemovalTimers.current.set(id, timer);
      return;
    }

    // Unchecking. If it's still within the grace window, cancel the pending removal —
    // nothing was ever committed to My Kitchen, so there's nothing to undo there.
    const pendingTimer = pendingRemovalTimers.current.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingRemovalTimers.current.delete(id);
      setPendingRemovalIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setList((prev) => prev.map((item) => (item.id === id ? { ...item, checked: false } : item)));
      return;
    }

    // No pending timer (shouldn't normally happen — a fully-checked item should already have
    // been removed by then) — fall back to the old undo-the-kitchen-tracking behavior.
    removeFromKitchenByName(target.name);
    setList((prev) => prev.map((item) => (item.id === id ? { ...item, checked: false } : item)));
  }

  function removeFromKitchenByName(name: string) {
    const key = simpleNameKey(name);
    setKitchen((prev) => prev.filter((k) => simpleNameKey(k.name) !== key));
  }

  function addToKitchenFromItem(item: Ingredient) {
    setKitchen((prev) => {
      const key = simpleNameKey(item.name);
      if (prev.some((k) => simpleNameKey(k.name) === key)) return prev; // already tracked
      return [...prev, { id: newId(), name: item.name, quantity: item.quantity, unit: item.unit, aisle: item.aisle, addedAt: Date.now() }];
    });
  }

  function cancelPendingRemoval(id: string) {
    const timer = pendingRemovalTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingRemovalTimers.current.delete(id);
    }
    setPendingRemovalIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function removeItem(id: string) {
    cancelPendingRemoval(id);
    setList((prev) => prev.filter((item) => item.id !== id));
  }

  function clearChecked() {
    // Treat this like the 10s grace window resolving early: whatever's checked right now
    // gets tracked into My Kitchen (same as if the timer had simply run out) and dropped.
    const checkedItems = list.filter((item) => item.checked);
    checkedItems.forEach((item) => {
      cancelPendingRemoval(item.id);
      addToKitchenFromItem(item);
    });
    setList((prev) => prev.filter((item) => !item.checked));
  }

  function clearAll() {
    if (list.length === 0) return;
    if (confirm("Clear the whole list? This can't be undone.")) {
      pendingRemovalTimers.current.forEach((t) => clearTimeout(t));
      pendingRemovalTimers.current.clear();
      setPendingRemovalIds(new Set());
      setList([]);
    }
  }

  async function handleShare() {
    // Respects whichever recipe chips are active — sharing should only include what's
    // currently shown, not every recipe on the list regardless of filter.
    if (displayedList.length === 0) return;
    const outcome = await shareOrCopyList(displayedList);
    setToast(outcome === "shared" ? "Shared!" : "Copied to clipboard");
  }

  function handleDownload() {
    if (displayedList.length === 0) return;
    downloadListAsText(displayedList);
  }

  function toggleFavorite(id: string) {
    setRecipes((prev) => prev.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r)));
  }

  function deleteRecipe(id: string) {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  }

  function toggleExpand(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addRecipeToList(recipe: Recipe) {
    setStatus({ kind: "scanning" });
    try {
      const result = await mergeRecipeIntoList(recipe.ingredients, recipe.name, list);
      setList(result.list);
      setStatus({ kind: "idle" });
      setToast(`Added "${recipe.name}" to your list`);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  async function handleManualAdd() {
    const name = manualName.trim();
    if (!name) return;
    setStatus({ kind: "scanning" });
    try {
      const qty = manualQty.trim() ? Number(manualQty.trim()) : null;
      const result = await mergeRecipeIntoList(
        [{ name, quantity: Number.isFinite(qty) ? qty : null, unit: manualUnit.trim() || null, note: null, aisle: manualAisle }],
        MANUAL_ENTRY_SOURCE,
        list
      );
      setList(result.list);
      setStatus({ kind: "idle" });
      setToast(`Added "${name}"`);
      setManualName("");
      setManualQty("");
      setManualUnit("");
      setAddItemOpen(false);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function updateRecipeMeta(id: string, field: "cookbookName" | "pageNumber", value: string) {
    setRecipes((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function toggleRecipeChip(name: string) {
    setRecipeChips((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function removeRecipeFromCurrentList(recipe: Recipe) {
    setStatus({ kind: "scanning" });
    try {
      const result = await removeRecipeFromListApi(recipe.name, list);
      setList(result.list);
      setStatus({ kind: "idle" });
      setToast(`Removed "${recipe.name}" from your list`);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  // Same as above, but by name only — used by the recipe-chip "x" in the list view, where we
  // have the chip's recipe name but not necessarily a saved Recipe object (manual entries and
  // "ran out" additions are recipe-shaped too, but aren't in `recipes`).
  async function removeRecipeByName(name: string) {
    setStatus({ kind: "scanning" });
    try {
      const result = await removeRecipeFromListApi(name, list);
      setList(result.list);
      setRecipeChips((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      setStatus({ kind: "idle" });
      setToast(`Removed "${name}" from your list`);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function openPantryScanner() {
    pantryFileInputRef.current?.click();
  }

  async function onPantryFileChosen(file: File) {
    try {
      const { dataUrl } = await resizeImage(file);
      setPantryPhotos((prev) => [...prev, { id: newId(), dataUrl }]);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Couldn't read that photo" });
    }
  }

  function onPantryFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onPantryFileChosen(file);
    e.target.value = "";
  }

  function removePantryPhoto(id: string) {
    setPantryPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function submitPantryScan() {
    if (pantryPhotos.length === 0) return;
    setStatus({ kind: "scanning" });
    try {
      const result = await scanPantryPhotos(pantryPhotos.map((p) => dataUrlToBlob(p.dataUrl)));
      setPantryReview(
        result.items.map((item) => ({
          id: newId(),
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          aisle: (AISLES as readonly string[]).includes(item.aisle) ? (item.aisle as Aisle) : "Other",
          confidence: item.confidence,
          addedAt: Date.now(),
        }))
      );
      // The photos have now served their purpose — clear the cache so they don't stick
      // around after being scanned (they stay cached, though, if the user navigates away
      // without scanning, or cancels here without saving — see cancelKitchenReview).
      setPantryPhotos([]);
      setStatus({ kind: "idle" });
      setView("kitchenReview");
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  function updatePantryReviewItem(id: string, field: "name" | "quantity", value: string | number | null) {
    setPantryReview((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function removePantryReviewItem(id: string) {
    setPantryReview((prev) => prev.filter((item) => item.id !== id));
  }

  function addPantryReviewBlank() {
    setPantryReview((prev) => [...prev, { id: newId(), name: "", quantity: null, unit: null, aisle: AISLES[0], addedAt: Date.now() }]);
  }

  function cancelKitchenReview() {
    setPantryPhotos([]);
    setPantryReview([]);
    goTo("kitchen");
  }

  function saveKitchenReview() {
    const validItems = pantryReview.filter((item) => item.name.trim());
    setKitchen((prev) => {
      const next = [...prev];
      for (const item of validItems) {
        const key = simpleNameKey(item.name);
        const existingIdx = next.findIndex((k) => simpleNameKey(k.name) === key);
        if (existingIdx >= 0) {
          next[existingIdx] = {
            ...next[existingIdx],
            quantity: item.quantity ?? next[existingIdx].quantity,
            unit: item.unit ?? next[existingIdx].unit,
            confidence: item.confidence,
            addedAt: Date.now(),
          };
        } else {
          next.push({ ...item, name: item.name.trim() });
        }
      }
      return next;
    });
    setPantryPhotos([]);
    setPantryReview([]);
    setToast("Saved to My Kitchen");
    goTo("kitchen");
  }

  function handleManualKitchenAdd() {
    const name = manualKitchenName.trim();
    if (!name) return;
    const qtyNum = manualKitchenQty.trim() ? Number(manualKitchenQty.trim()) : null;
    const quantity = qtyNum !== null && Number.isFinite(qtyNum) ? qtyNum : null;
    const unit = manualKitchenUnit.trim() || null;

    setKitchen((prev) => {
      const key = simpleNameKey(name);
      const existingIdx = prev.findIndex((k) => simpleNameKey(k.name) === key);
      if (existingIdx >= 0) {
        // Already tracked — combine rather than creating a duplicate row, same spirit as
        // the grocery-list merge logic (sum when the unit matches, otherwise just top up
        // the quantity/unit with whatever was just entered).
        const next = [...prev];
        const existing = next[existingIdx];
        const sameUnit = existing.unit === unit;
        const combinedQty =
          sameUnit && existing.quantity !== null && quantity !== null ? existing.quantity + quantity : quantity ?? existing.quantity;
        next[existingIdx] = { ...existing, quantity: combinedQty, unit: unit ?? existing.unit, addedAt: Date.now() };
        return next;
      }
      return [...prev, { id: newId(), name, quantity, unit, aisle: manualKitchenAisle, addedAt: Date.now() }];
    });

    setToast(`Added "${name}" to My Kitchen`);
    setManualKitchenName("");
    setManualKitchenQty("");
    setManualKitchenUnit("");
    setAddKitchenItemOpen(false);
  }

  function startEditListItem(item: Ingredient) {
    setListEditDraft({ id: item.id, name: item.name, qty: item.quantity !== null ? String(item.quantity) : "", unit: item.unit ?? "" });
  }

  function cancelEditListItem() {
    setListEditDraft(null);
  }

  function saveEditListItem() {
    if (!listEditDraft) return;
    const trimmedName = listEditDraft.name.trim();
    if (!trimmedName) return;
    const qtyNum = listEditDraft.qty.trim() ? Number(listEditDraft.qty.trim()) : null;
    setList((prev) =>
      prev.map((item) =>
        item.id === listEditDraft.id
          ? { ...item, name: trimmedName, quantity: qtyNum !== null && Number.isFinite(qtyNum) ? qtyNum : null, unit: listEditDraft.unit.trim() || null }
          : item
      )
    );
    setListEditDraft(null);
  }

  function startEditKitchenItem(item: KitchenItem) {
    setKitchenEditDraft({
      id: item.id,
      name: item.name,
      qty: item.quantity !== null ? String(item.quantity) : "",
      unit: item.unit ?? "",
      aisle: item.aisle,
    });
  }

  function cancelEditKitchenItem() {
    setKitchenEditDraft(null);
  }

  function saveEditKitchenItem() {
    if (!kitchenEditDraft) return;
    const trimmedName = kitchenEditDraft.name.trim();
    if (!trimmedName) return;
    const qtyNum = kitchenEditDraft.qty.trim() ? Number(kitchenEditDraft.qty.trim()) : null;
    setKitchen((prev) =>
      prev.map((item) =>
        item.id === kitchenEditDraft.id
          ? {
              ...item,
              name: trimmedName,
              quantity: qtyNum !== null && Number.isFinite(qtyNum) ? qtyNum : null,
              unit: kitchenEditDraft.unit.trim() || null,
              aisle: kitchenEditDraft.aisle,
            }
          : item
      )
    );
    setKitchenEditDraft(null);
  }

  function clearKitchen() {
    if (kitchen.length === 0) return;
    if (confirm("Clear everything from My Kitchen? This can't be undone.")) {
      setKitchen([]);
    }
  }

  function deleteKitchenItem(id: string) {
    setKitchen((prev) => prev.filter((item) => item.id !== id));
  }

  async function moveKitchenItemToList(item: KitchenItem) {
    setStatus({ kind: "scanning" });
    try {
      const result = await mergeRecipeIntoList(
        [{ name: item.name, quantity: item.quantity, unit: item.unit, note: null, aisle: item.aisle }],
        RAN_OUT_SOURCE,
        list
      );
      setList(result.list);
      setKitchen((prev) => prev.filter((k) => k.id !== item.id));
      setStatus({ kind: "idle" });
      setToast(`Added "${item.name}" to your grocery list`);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  const totalCount = list.length;
  const checkedCount = list.filter((i) => i.checked).length;
  const visibleRecipes = recipeFilter === "favorites" ? recipes.filter((r) => r.favorite) : recipes;
  const recipeNamesInList = new Set(list.flatMap((item) => item.sourceRecipes));
  const favoriteCount = recipes.filter((r) => r.favorite).length;
  const pillLabel = totalCount === 0 ? "Empty" : `${totalCount} item${totalCount === 1 ? "" : "s"}`;
  const recipeNamesInCurrentList = Array.from(new Set(list.flatMap((item) => item.sourceRecipes))).sort();
  const displayedList = recipeChips.size === 0 ? list : list.filter((item) => item.sourceRecipes.some((n) => recipeChips.has(n)));
  const kitchenKeySet = new Set(kitchen.map((k) => simpleNameKey(k.name)));
  const meatDuplicateCandidate = findMeatDuplicateCandidate(list, dismissedMeatPairs);

  function resolveMeatDuplicate(action: "separate" | "combine") {
    if (!meatDuplicateCandidate) return;
    const { a, b, pairKey } = meatDuplicateCandidate;
    if (action === "separate") {
      setDismissedMeatPairs((prev) => new Set(prev).add(pairKey));
      return;
    }
    const combined = combineTwoIngredients(a, b);
    setList((prev) => [...prev.filter((i) => i.id !== a.id && i.id !== b.id), combined]);
    setToast(`Combined into one "${combined.name}"`);
  }

  function goTo(v: View) {
    setView(v);
    setSheetOpen(false);
  }

  function closeSheet() {
    setSheetOpen(false);
    setDragY(0);
  }

  // Lets the Quick Access sheet be dragged down and dismissed with a swipe, instead of
  // only being closeable by tapping the dark overlay behind it.
  function handleSheetTouchStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0].clientY;
    dragging.current = true;
  }

  function handleSheetTouchMove(e: React.TouchEvent) {
    if (!dragging.current || dragStartY.current === null) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta > 0) setDragY(delta);
  }

  function handleSheetTouchEnd() {
    if (dragging.current && dragY > 80) {
      closeSheet();
    } else {
      setDragY(0);
    }
    dragging.current = false;
    dragStartY.current = null;
  }

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileInputChange}
        style={{ display: "none" }}
      />
      <input
        ref={pantryFileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPantryFileInputChange}
        style={{ display: "none" }}
      />

      {/* ---------------- HOME ---------------- */}
      {view === "home" && (
        <div className="screen">
          <header className="home-header">
            <h1>Grocery Scanner</h1>
            <p className="subtitle">Snap a recipe photo, get an organized shopping list.</p>
          </header>

          <button className="cta-card" onClick={openScanner} disabled={status.kind === "scanning"}>
            <span className="cta-icon-circle">
              <IconCamera />
            </span>
            <span className="cta-text">
              <span className="cta-title">{status.kind === "scanning" ? "Working…" : "What's cooking?"}</span>
              <span className="cta-subtitle">
                {status.kind === "scanning" ? "Reading your recipe photo…" : "Tap to add a recipe photo"}
              </span>
            </span>
            <IconChevronRight />
          </button>

          {status.kind === "error" && <p className="error-text">{status.message}</p>}
          {status.kind === "done" && (
            <>
              <p className="success-text">Added ingredients from "{status.recipeName}"</p>
              {(status.cookbookName || status.pageNumber) && (
                <p className="cookbook-confirm-text">
                  We noticed this is from the cookbook "{status.cookbookName ?? "?"}" and the recipe is on page "
                  {status.pageNumber ?? "?"}" — look correct? You can fix it on the recipe card.
                </p>
              )}
            </>
          )}

          <button className="pantry-cta" onClick={() => goTo("kitchenScan")} disabled={status.kind === "scanning"}>
            <span className="pantry-cta-icon">
              <IconFridge color="currentColor" />
            </span>
            <span className="pantry-cta-text">
              <span className="pantry-cta-title">What's in my kitchen?</span>
              <span className="pantry-cta-subtitle">Snap your shelves so we don't double up</span>
            </span>
            <IconChevronRight color="#c7c7cc" />
          </button>

          <div className="shortcuts-label">SHORTCUTS</div>
          <div className="shortcuts-card">
            <button className="shortcut-row" onClick={() => goTo("list")}>
              <IconCart color="#4a4a4a" />
              <span className="shortcut-text">
                <span className="shortcut-title">Current List</span>
                <span className="shortcut-sub">{totalCount === 0 ? "No items yet" : `${checkedCount} / ${totalCount} picked up`}</span>
              </span>
              <IconChevronRight />
            </button>
            <button
              className="shortcut-row"
              onClick={() => {
                setRecipeFilter("all");
                goTo("recipes");
              }}
            >
              <IconBook color="#4a4a4a" />
              <span className="shortcut-text">
                <span className="shortcut-title">Your Recipes</span>
                <span className="shortcut-sub">{recipes.length === 0 ? "None saved yet" : `${recipes.length} saved`}</span>
              </span>
              <IconChevronRight />
            </button>
            <button
              className="shortcut-row"
              onClick={() => {
                setRecipeFilter("favorites");
                goTo("recipes");
              }}
            >
              <IconStar color="#4a4a4a" />
              <span className="shortcut-text">
                <span className="shortcut-title">Favorites</span>
                <span className="shortcut-sub">{favoriteCount === 0 ? "None starred yet" : `${favoriteCount} starred`}</span>
              </span>
              <IconChevronRight />
            </button>
            <button className="shortcut-row" onClick={() => goTo("kitchen")}>
              <IconFridge color="#4a4a4a" />
              <span className="shortcut-text">
                <span className="shortcut-title">My Kitchen</span>
                <span className="shortcut-sub">
                  {kitchen.length === 0 ? "Nothing tracked yet" : `${kitchen.length} item${kitchen.length === 1 ? "" : "s"} on hand`}
                </span>
              </span>
              <IconChevronRight />
            </button>
            <div className="shortcut-row disabled">
              <IconNote />
              <span className="shortcut-text">
                <span className="shortcut-title">Notes</span>
                <span className="shortcut-sub">Nothing to share yet</span>
              </span>
            </div>
            <div className="shortcut-row disabled">
              <IconReminder />
              <span className="shortcut-text">
                <span className="shortcut-title">Reminders</span>
                <span className="shortcut-sub">Nothing to share yet</span>
              </span>
            </div>
          </div>

          <div className="tip-card">
            <IconTip />
            <span>Ingredients from multiple recipes merge automatically into one list — no duplicate entries to clean up.</span>
          </div>
        </div>
      )}

      {/* ---------------- GROCERY LIST ---------------- */}
      {view === "list" && (
        <div className="screen">
          <header className="page-header">
            <button className="back-link" onClick={() => goTo("home")} aria-label="Back home">
              ‹
            </button>
            <h1>Grocery Scanner</h1>
            <div className="header-pills">
              <button
                className="pill-chip"
                onClick={() => {
                  setRecipeFilter("all");
                  goTo("recipes");
                }}
              >
                <IconBook color="currentColor" /> Recipes
              </button>
              <button
                className="pill-chip"
                onClick={() => {
                  setRecipeFilter("favorites");
                  goTo("recipes");
                }}
              >
                <IconStar color="currentColor" /> Favorites
              </button>
            </div>
          </header>

          <button className="add-another-pill" onClick={openScanner} disabled={status.kind === "scanning"}>
            <IconCamera color="currentColor" />
            {status.kind === "scanning" ? "Working…" : "Add another recipe"}
          </button>

          {status.kind === "error" && <p className="error-text">{status.message}</p>}
          {status.kind === "done" && (
            <>
              <p className="success-text">Added ingredients from "{status.recipeName}"</p>
              {(status.cookbookName || status.pageNumber) && (
                <p className="cookbook-confirm-text">
                  We noticed this is from the cookbook "{status.cookbookName ?? "?"}" and the recipe is on page "
                  {status.pageNumber ?? "?"}" — look correct? You can fix it on the recipe card.
                </p>
              )}
            </>
          )}

          {totalCount > 0 ? (
            <>
              <div className="list-toolbar">
                <span className="progress-text">
                  {checkedCount} / {totalCount} picked up
                </span>
                <div className="toolbar-buttons">
                  <button onClick={handleShare} className="secondary-button">
                    Share
                  </button>
                  <button onClick={handleDownload} className="secondary-button">
                    .txt
                  </button>
                  {checkedCount > 0 && (
                    <button onClick={clearChecked} className="secondary-button">
                      Clear checked
                    </button>
                  )}
                  <button onClick={clearAll} className="secondary-button danger">
                    Clear all
                  </button>
                  <button onClick={() => setAddItemOpen((v) => !v)} className="secondary-button">
                    + Add item
                  </button>
                </div>
              </div>

              {addItemOpen && (
                <div className="manual-add-card">
                  <input
                    className="manual-input manual-input-name"
                    placeholder="Ingredient name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="manual-input manual-input-qty"
                    placeholder="Qty"
                    inputMode="decimal"
                    value={manualQty}
                    onChange={(e) => setManualQty(e.target.value)}
                  />
                  <input
                    className="manual-input manual-input-unit"
                    placeholder="Unit"
                    value={manualUnit}
                    onChange={(e) => setManualUnit(e.target.value)}
                  />
                  <select
                    className="manual-input manual-input-aisle"
                    value={manualAisle}
                    onChange={(e) => setManualAisle(e.target.value as Aisle)}
                  >
                    {AISLES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <div className="manual-add-actions">
                    <button className="secondary-button" onClick={() => setAddItemOpen(false)}>
                      Cancel
                    </button>
                    <button className="secondary-button primary-ish" onClick={handleManualAdd} disabled={!manualName.trim()}>
                      Add
                    </button>
                  </div>
                </div>
              )}

              {recipeNamesInCurrentList.length > 0 && (
                <div className="recipe-chip-row">
                  <button
                    className={`recipe-chip ${recipeChips.size === 0 ? "recipe-chip-active" : ""}`}
                    onClick={() => setRecipeChips(new Set())}
                  >
                    All
                  </button>
                  {recipeNamesInCurrentList.map((name) => (
                    <span key={name} className="recipe-chip-wrap">
                      <button
                        className={`recipe-chip ${recipeChips.has(name) ? "recipe-chip-active" : ""}`}
                        onClick={() => toggleRecipeChip(name)}
                      >
                        {name}
                      </button>
                      <button
                        className="recipe-chip-remove"
                        onClick={() => removeRecipeByName(name)}
                        aria-label={`Clear "${name}" from your list`}
                        title={`Not shopping for "${name}" this week — clear its items`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="grocery-list">
                {AISLES.map((aisle) => {
                  const items = displayedList.filter((i) => i.aisle === aisle);
                  if (items.length === 0) return null;
                  return (
                    <section key={aisle} className="aisle-section">
                      <h2 className="aisle-title">{aisle}</h2>
                      <ul className="item-list">
                        {items.map((item) =>
                          listEditDraft?.id === item.id ? (
                            <li key={item.id} className="item-row item-row-editing">
                              <div className="inline-edit-form">
                                <input
                                  className="manual-input manual-input-name"
                                  value={listEditDraft.name}
                                  onChange={(e) => setListEditDraft({ ...listEditDraft, name: e.target.value })}
                                  autoFocus
                                />
                                <input
                                  className="manual-input manual-input-qty"
                                  placeholder="Qty"
                                  inputMode="decimal"
                                  value={listEditDraft.qty}
                                  onChange={(e) => setListEditDraft({ ...listEditDraft, qty: e.target.value })}
                                />
                                <input
                                  className="manual-input manual-input-unit"
                                  placeholder="Unit"
                                  value={listEditDraft.unit}
                                  onChange={(e) => setListEditDraft({ ...listEditDraft, unit: e.target.value })}
                                />
                                <div className="inline-edit-actions">
                                  <button className="secondary-button" onClick={cancelEditListItem}>
                                    Cancel
                                  </button>
                                  <button className="secondary-button primary-ish" onClick={saveEditListItem} disabled={!listEditDraft.name.trim()}>
                                    Save
                                  </button>
                                </div>
                              </div>
                            </li>
                          ) : (
                            <li
                              key={item.id}
                              className={`item-row ${item.checked ? "checked" : ""} ${
                                pendingRemovalIds.has(item.id) ? "pending-removal" : ""
                              }`}
                            >
                              <label className="item-label">
                                <input type="checkbox" checked={item.checked} onChange={() => toggleChecked(item.id)} />
                                <span className="item-text">
                                  <span className="item-name">{item.name}</span>
                                  {formatListQuantity(item) && <span className="item-qty"> — {formatListQuantity(item)}</span>}
                                  {item.note && <span className="item-note"> ({item.note})</span>}
                                  {pendingRemovalIds.has(item.id) && (
                                    <span className="pending-removal-note">Removing in 10s — uncheck to keep it</span>
                                  )}
                                  {item.sourceRecipes.length > 1 && (
                                    <span className="shared-badge">
                                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#5b6fa0" strokeWidth="2.4">
                                        <circle cx="9" cy="12" r="6" />
                                        <circle cx="15" cy="12" r="6" />
                                      </svg>
                                      {item.sourceRecipes.length} recipes
                                    </span>
                                  )}
                                  {kitchenKeySet.has(simpleNameKey(item.name)) && (
                                    <span className="kitchen-flag-badge">
                                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#a8752f" strokeWidth="2.4">
                                        <rect x="5" y="2.5" width="14" height="19" rx="2.2" />
                                        <line x1="5" y1="9.5" x2="19" y2="9.5" />
                                      </svg>
                                      In your kitchen — check amount
                                    </span>
                                  )}
                                  <span className="item-source">{item.sourceRecipes.join(", ")}</span>
                                </span>
                              </label>
                              <div className="item-row-actions">
                                {!pendingRemovalIds.has(item.id) && (
                                  <button className="edit-button" onClick={() => startEditListItem(item)} aria-label={`Edit ${item.name}`}>
                                    ✎
                                  </button>
                                )}
                                <button className="remove-button" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>
                                  ✕
                                </button>
                              </div>
                            </li>
                          )
                        )}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>No items yet. Take a photo of a recipe's ingredient list to get started.</p>
            </div>
          )}
        </div>
      )}

      {/* ---------------- RECIPES / FAVORITES ---------------- */}
      {view === "recipes" && (
        <div className="screen">
          <header className="page-header">
            <button className="back-link" onClick={() => goTo("home")} aria-label="Back home">
              ‹
            </button>
            <h1>Your recipes</h1>
            <button className="add-new-pill" onClick={() => goTo("home")}>
              + Add New
            </button>
          </header>

          <div className="filter-chips">
            <button className={`chip ${recipeFilter === "all" ? "chip-active" : ""}`} onClick={() => setRecipeFilter("all")}>
              All
            </button>
            <button
              className={`chip ${recipeFilter === "favorites" ? "chip-active" : ""}`}
              onClick={() => setRecipeFilter("favorites")}
            >
              <IconStar color={recipeFilter === "favorites" ? "#fff" : "#666"} filled={recipeFilter === "favorites"} /> Favorites
            </button>
          </div>

          {visibleRecipes.length === 0 && (
            <p className="empty-state small">
              {recipeFilter === "favorites"
                ? "No favorites yet — tap the star on a recipe to save it here."
                : "No recipes yet — scan one from the home screen to get started."}
            </p>
          )}

          <div className="recipe-cards">
            {visibleRecipes.map((recipe) => {
              const isCollapsed = collapsedIds.has(recipe.id);
              const isInList = recipeNamesInList.has(recipe.name);
              return (
                <div key={recipe.id} className="recipe-card">
                  <div className="recipe-card-heading">
                    <h3 className="recipe-name">{recipe.name}</h3>
                    <button
                      className="star-button"
                      onClick={() => toggleFavorite(recipe.id)}
                      aria-label={recipe.favorite ? "Unfavorite" : "Favorite"}
                    >
                      <IconStar color="#d9a441" filled={recipe.favorite} />
                    </button>
                  </div>

                  <img src={recipe.photoDataUrl} alt={recipe.name} className="recipe-photo" />

                  <div className="recipe-source-row">
                    <input
                      className="recipe-source-input"
                      placeholder="Cookbook name"
                      value={recipe.cookbookName ?? ""}
                      onChange={(e) => updateRecipeMeta(recipe.id, "cookbookName", e.target.value)}
                    />
                    <input
                      className="recipe-source-input recipe-source-input-page"
                      placeholder="Page #"
                      value={recipe.pageNumber ?? ""}
                      onChange={(e) => updateRecipeMeta(recipe.id, "pageNumber", e.target.value)}
                    />
                  </div>

                  <div className="recipe-card-footer">
                    <span className="recipe-meta">
                      {recipe.ingredients.length} ingredients{isInList ? " · in your list" : ""}
                    </span>
                    <div className="recipe-card-actions">
                      {isInList ? (
                        <button className="secondary-button danger" onClick={() => removeRecipeFromCurrentList(recipe)}>
                          Remove from list
                        </button>
                      ) : (
                        <button className="secondary-button" onClick={() => addRecipeToList(recipe)}>
                          Add to list
                        </button>
                      )}
                      <button className="secondary-button danger" onClick={() => deleteRecipe(recipe.id)}>
                        Delete recipe
                      </button>
                    </div>
                  </div>

                  <button className="toggle-expand" onClick={() => toggleExpand(recipe.id)}>
                    {isCollapsed ? "Show extracted ingredients ▾" : "Hide extracted ingredients ▴"}
                  </button>

                  {!isCollapsed && (
                    <ul className="extracted-list">
                      {recipe.ingredients.map((ing, idx) => (
                        <li key={idx} className="extracted-item">
                          <span className="item-name">{ing.name}</span>
                          {formatQuantity(ing) && <span className="item-qty"> — {formatQuantity(ing)}</span>}
                          {ing.note && <span className="item-note"> ({ing.note})</span>}
                          <span className="extracted-aisle"> · {ing.aisle}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- MY KITCHEN ---------------- */}
      {view === "kitchen" && (
        <div className="screen">
          <header className="page-header">
            <button className="back-link" onClick={() => goTo("home")} aria-label="Back home">
              ‹
            </button>
            <h1>My Kitchen</h1>
          </header>

          <p className="subtitle">What's already in your fridge and pantry, so recipes can flag what you don't need to buy.</p>

          <div className="kitchen-toolbar">
            <button className="secondary-button primary-ish" onClick={() => goTo("kitchenScan")}>
              <IconCamera color="currentColor" /> Snap new pics
            </button>
            <button className="secondary-button" onClick={() => setAddKitchenItemOpen((v) => !v)}>
              + Add item
            </button>
            {kitchen.length > 0 && (
              <button className="secondary-button danger" onClick={clearKitchen}>
                Clear my kitchen
              </button>
            )}
          </div>

          {addKitchenItemOpen && (
            <div className="manual-add-card">
              <input
                className="manual-input manual-input-name"
                placeholder="Item name"
                value={manualKitchenName}
                onChange={(e) => setManualKitchenName(e.target.value)}
                autoFocus
              />
              <input
                className="manual-input manual-input-qty"
                placeholder="Qty"
                inputMode="decimal"
                value={manualKitchenQty}
                onChange={(e) => setManualKitchenQty(e.target.value)}
              />
              <input
                className="manual-input manual-input-unit"
                placeholder="Unit"
                value={manualKitchenUnit}
                onChange={(e) => setManualKitchenUnit(e.target.value)}
              />
              <select
                className="manual-input manual-input-aisle"
                value={manualKitchenAisle}
                onChange={(e) => setManualKitchenAisle(e.target.value as Aisle)}
              >
                {AISLES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <div className="manual-add-actions">
                <button className="secondary-button" onClick={() => setAddKitchenItemOpen(false)}>
                  Cancel
                </button>
                <button className="secondary-button primary-ish" onClick={handleManualKitchenAdd} disabled={!manualKitchenName.trim()}>
                  Add
                </button>
              </div>
            </div>
          )}

          {kitchen.length === 0 ? (
            <div className="empty-state">
              <p>Nothing tracked yet. Snap a photo of your fridge or pantry and we'll keep a running list of what you've got.</p>
            </div>
          ) : (
            <div className="kitchen-list">
              {kitchen
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) =>
                  kitchenEditDraft?.id === item.id ? (
                    <div key={item.id} className="kitchen-row kitchen-row-editing">
                      <div className="inline-edit-form">
                        <input
                          className="manual-input manual-input-name"
                          value={kitchenEditDraft.name}
                          onChange={(e) => setKitchenEditDraft({ ...kitchenEditDraft, name: e.target.value })}
                          autoFocus
                        />
                        <input
                          className="manual-input manual-input-qty"
                          placeholder="Qty"
                          inputMode="decimal"
                          value={kitchenEditDraft.qty}
                          onChange={(e) => setKitchenEditDraft({ ...kitchenEditDraft, qty: e.target.value })}
                        />
                        <input
                          className="manual-input manual-input-unit"
                          placeholder="Unit"
                          value={kitchenEditDraft.unit}
                          onChange={(e) => setKitchenEditDraft({ ...kitchenEditDraft, unit: e.target.value })}
                        />
                        <select
                          className="manual-input manual-input-aisle"
                          value={kitchenEditDraft.aisle}
                          onChange={(e) => setKitchenEditDraft({ ...kitchenEditDraft, aisle: e.target.value as Aisle })}
                        >
                          {AISLES.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        <div className="inline-edit-actions">
                          <button className="secondary-button" onClick={cancelEditKitchenItem}>
                            Cancel
                          </button>
                          <button
                            className="secondary-button primary-ish"
                            onClick={saveEditKitchenItem}
                            disabled={!kitchenEditDraft.name.trim()}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={item.id} className="kitchen-row">
                      <div className="kitchen-row-text">
                        <span className="item-name">{item.name}</span>
                        {formatListQuantity(item) && <span className="item-qty"> — {formatListQuantity(item)}</span>}
                        {item.confidence === "low" && <span className="confidence-badge">best guess</span>}
                      </div>
                      <div className="kitchen-row-actions">
                        <button className="secondary-button" onClick={() => moveKitchenItemToList(item)}>
                          Ran out — add to list
                        </button>
                        <button className="edit-button" onClick={() => startEditKitchenItem(item)} aria-label={`Edit ${item.name}`}>
                          ✎
                        </button>
                        <button className="remove-button" onClick={() => deleteKitchenItem(item.id)} aria-label={`Remove ${item.name}`}>
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- KITCHEN PHOTO SCAN ---------------- */}
      {view === "kitchenScan" && (
        <div className="screen">
          <header className="page-header">
            <button className="back-link" onClick={() => goTo("kitchen")} aria-label="Back">
              ‹
            </button>
            <h1>What's in my kitchen?</h1>
          </header>

          <p className="subtitle">
            Snap a few photos — fridge, freezer, pantry shelf, wherever. They'll stay here until you scan them or
            remove them, so you won't have to retake them if you step away.
          </p>

          {pantryPhotos.length > 0 && (
            <div className="pantry-photo-strip">
              {pantryPhotos.map((p, idx) => (
                <div key={p.id} className="pantry-photo-thumb">
                  <img src={p.dataUrl} alt={`Kitchen photo ${idx + 1}`} />
                  <button className="pantry-photo-remove" onClick={() => removePantryPhoto(p.id)} aria-label="Remove photo">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="add-another-pill" onClick={openPantryScanner} disabled={status.kind === "scanning"}>
            <IconCamera color="currentColor" />
            {pantryPhotos.length === 0 ? "Take a photo" : "Add another photo"}
          </button>

          {status.kind === "error" && <p className="error-text">{status.message}</p>}

          <div className="kitchen-scan-actions">
            <button className="secondary-button" onClick={() => goTo("kitchen")}>
              Cancel
            </button>
            <button
              className="secondary-button primary-ish"
              onClick={submitPantryScan}
              disabled={pantryPhotos.length === 0 || status.kind === "scanning"}
            >
              {status.kind === "scanning" ? "Looking…" : `Scan ${pantryPhotos.length} photo${pantryPhotos.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- KITCHEN SCAN REVIEW ---------------- */}
      {view === "kitchenReview" && (
        <div className="screen">
          <header className="page-header">
            <button className="back-link" onClick={cancelKitchenReview} aria-label="Back">
              ‹
            </button>
            <h1>Check what we found</h1>
          </header>

          <p className="subtitle">Fix anything we got wrong, then save it to My Kitchen.</p>

          <div className="kitchen-review-list">
            {pantryReview.length === 0 && (
              <p className="empty-state small">Nothing found — add items by hand below, or go back and snap another photo.</p>
            )}
            {pantryReview.map((item) => (
              <div key={item.id} className="kitchen-review-row">
                <input
                  className="manual-input manual-input-name"
                  placeholder="Item name"
                  value={item.name}
                  onChange={(e) => updatePantryReviewItem(item.id, "name", e.target.value)}
                />
                <input
                  className="manual-input manual-input-qty"
                  placeholder="Qty"
                  inputMode="decimal"
                  value={item.quantity ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updatePantryReviewItem(item.id, "quantity", v.trim() === "" ? null : Number(v));
                  }}
                />
                {item.confidence === "low" && <span className="confidence-badge">best guess</span>}
                <button className="remove-button" onClick={() => removePantryReviewItem(item.id)} aria-label={`Remove ${item.name || "item"}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button className="secondary-button" onClick={addPantryReviewBlank}>
            + Add item
          </button>

          <div className="kitchen-scan-actions">
            <button className="secondary-button" onClick={cancelKitchenReview}>
              Cancel
            </button>
            <button
              className="secondary-button primary-ish"
              onClick={saveKitchenReview}
              disabled={pantryReview.every((item) => !item.name.trim())}
            >
              Save to My Kitchen
            </button>
          </div>
        </div>
      )}

      {/* ---------------- FLOATING GROCERY-LIST PILL (every screen) ---------------- */}
      <div className="floating-pill">
        {view === "list" ? (
          <button className="pill-quick-access" onClick={() => setSheetOpen(true)}>
            <IconChevronUp color="#3f8f7f" />
            Quick Access
          </button>
        ) : (
          <>
            <button className="pill-segment-list" onClick={() => goTo("list")}>
              <IconCart />
              <span className="pill-title">Grocery List</span>
              <span className="pill-status">· {pillLabel}</span>
            </button>
            <div className="pill-divider" />
            <button className="pill-segment-chevron" onClick={() => setSheetOpen(true)} aria-label="Quick access">
              <IconChevronUp />
            </button>
          </>
        )}
      </div>

      {/* ---------------- QUICK ACCESS SHEET ---------------- */}
      {sheetOpen && (
        <div className="sheet-overlay" onClick={closeSheet}>
          <div
            className="sheet"
            style={{ transform: `translateY(${dragY}px)`, transition: dragging.current ? "none" : "transform 0.2s ease" }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
          >
            <div className="sheet-handle" />
            <div className="sheet-title">Quick Access</div>
            <div className="sheet-subtitle">Jump to your list or recipes, or send this list elsewhere</div>

            <div className="sheet-section-label">Go to</div>
            <div className="sheet-nav-list">
              <button className="sheet-nav-row highlight" onClick={() => goTo("list")}>
                <IconCart />
                <span className="sheet-nav-text">
                  Current List <span className="sheet-nav-sub">· {pillLabel}</span>
                </span>
                <IconChevronRight />
              </button>
              <button
                className="sheet-nav-row"
                onClick={() => {
                  setRecipeFilter("all");
                  goTo("recipes");
                }}
              >
                <IconBook color="currentColor" />
                <span className="sheet-nav-text">Your Recipes</span>
                <IconChevronRight />
              </button>
              <button
                className="sheet-nav-row"
                onClick={() => {
                  setRecipeFilter("favorites");
                  goTo("recipes");
                }}
              >
                <IconStar color="currentColor" />
                <span className="sheet-nav-text">Favorites</span>
                <IconChevronRight />
              </button>
            </div>

            <div className="sheet-section-label">Share list to</div>
            <div className="sheet-share-row">
              <button
                className="sheet-share-item"
                onClick={() => {
                  handleShare();
                  setSheetOpen(false);
                }}
                disabled={totalCount === 0}
              >
                <span className="sheet-share-icon">
                  <IconNote color="#5b6572" />
                </span>
                Share
              </button>
              <button
                className="sheet-share-item"
                onClick={() => {
                  handleDownload();
                  setSheetOpen(false);
                }}
                disabled={totalCount === 0}
              >
                <span className="sheet-share-icon">
                  <IconReminder color="#5b6572" />
                </span>
                .txt file
              </button>
            </div>

            <button className="sheet-cancel" onClick={closeSheet}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---------------- SHARED-ITEM CONFIRMATION (meat/seafood cuts named differently by 2 recipes) ---------------- */}
      {meatDuplicateCandidate && (
        <div className="sheet-overlay" onClick={() => resolveMeatDuplicate("separate")}>
          <div className="meat-duplicate-modal" onClick={(e) => e.stopPropagation()}>
            <div className="meat-duplicate-title">Buying two of the same thing?</div>
            <p className="meat-duplicate-text">
              We noticed 2 recipes both call for a {meatDuplicateCandidate.keyword} — "{meatDuplicateCandidate.a.name}" (
              {meatDuplicateCandidate.a.sourceRecipes.join(", ")}) and "{meatDuplicateCandidate.b.name}" (
              {meatDuplicateCandidate.b.sourceRecipes.join(", ")}). Do you want to buy both, or are you planning to
              share one across the two recipes?
            </p>
            <div className="meat-duplicate-actions">
              <button className="secondary-button" onClick={() => resolveMeatDuplicate("separate")}>
                Buy both
              </button>
              <button className="secondary-button primary-ish" onClick={() => resolveMeatDuplicate("combine")}>
                Just get one
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
