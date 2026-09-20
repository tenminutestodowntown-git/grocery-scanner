import { useEffect, useRef, useState } from "react";
import "./App.css";
import { AISLES, MANUAL_ENTRY_SOURCE } from "./types";
import type { Aisle, Ingredient, Recipe } from "./types";
import { loadList, saveList, loadRecipes, saveRecipes } from "./storage";
import { scanRecipePhoto, mergeRecipeIntoList, removeRecipeFromList as removeRecipeFromListApi } from "./api";
import { shareOrCopyList, downloadListAsText } from "./export";
import { resizeImage } from "./image";

type Status = { kind: "idle" } | { kind: "scanning" } | { kind: "error"; message: string } | { kind: "done"; recipeName: string };
type RecipeFilter = "all" | "favorites";
type View = "home" | "list" | "recipes";

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

  useEffect(() => {
    saveList(list);
  }, [list]);

  useEffect(() => {
    saveRecipes(recipes);
  }, [recipes]);

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
      };
      setRecipes((prev) => [recipe, ...prev]);

      setStatus({ kind: "done", recipeName: result.recipeName });
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
    setList((prev) => prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  }

  function removeItem(id: string) {
    setList((prev) => prev.filter((item) => item.id !== id));
  }

  function clearChecked() {
    setList((prev) => prev.filter((item) => !item.checked));
  }

  function clearAll() {
    if (list.length === 0) return;
    if (confirm("Clear the whole list? This can't be undone.")) {
      setList([]);
    }
  }

  async function handleShare() {
    if (list.length === 0) return;
    const outcome = await shareOrCopyList(list);
    setToast(outcome === "shared" ? "Shared!" : "Copied to clipboard");
  }

  function handleDownload() {
    if (list.length === 0) return;
    downloadListAsText(list);
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

  const totalCount = list.length;
  const checkedCount = list.filter((i) => i.checked).length;
  const visibleRecipes = recipeFilter === "favorites" ? recipes.filter((r) => r.favorite) : recipes;
  const recipeNamesInList = new Set(list.flatMap((item) => item.sourceRecipes));
  const favoriteCount = recipes.filter((r) => r.favorite).length;
  const pillLabel = totalCount === 0 ? "Empty" : `${totalCount} item${totalCount === 1 ? "" : "s"}`;
  const recipeNamesInCurrentList = Array.from(new Set(list.flatMap((item) => item.sourceRecipes))).sort();
  const displayedList = recipeChips.size === 0 ? list : list.filter((item) => item.sourceRecipes.some((n) => recipeChips.has(n)));

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
          {status.kind === "done" && <p className="success-text">Added ingredients from "{status.recipeName}"</p>}

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
          {status.kind === "done" && <p className="success-text">Added ingredients from "{status.recipeName}"</p>}

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
                    <button
                      key={name}
                      className={`recipe-chip ${recipeChips.has(name) ? "recipe-chip-active" : ""}`}
                      onClick={() => toggleRecipeChip(name)}
                    >
                      {name}
                    </button>
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
                        {items.map((item) => (
                          <li key={item.id} className={`item-row ${item.checked ? "checked" : ""}`}>
                            <label className="item-label">
                              <input type="checkbox" checked={item.checked} onChange={() => toggleChecked(item.id)} />
                              <span className="item-text">
                                <span className="item-name">{item.name}</span>
                                {formatListQuantity(item) && <span className="item-qty"> — {formatListQuantity(item)}</span>}
                                {item.note && <span className="item-note"> ({item.note})</span>}
                                {item.sourceRecipes.length > 1 && (
                                  <span className="shared-badge">
                                    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#5b6fa0" strokeWidth="2.4">
                                      <circle cx="9" cy="12" r="6" />
                                      <circle cx="15" cy="12" r="6" />
                                    </svg>
                                    {item.sourceRecipes.length} recipes
                                  </span>
                                )}
                                <span className="item-source">{item.sourceRecipes.join(", ")}</span>
                              </span>
                            </label>
                            <button className="remove-button" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>
                              ✕
                            </button>
                          </li>
                        ))}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
