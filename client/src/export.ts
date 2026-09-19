import { AISLES } from "./types";
import type { Ingredient } from "./types";

function formatLine(item: Ingredient): string {
  const parts: string[] = [];
  if (item.quantity !== null) {
    parts.push(String(item.quantity));
  }
  if (item.unit) {
    parts.push(item.unit);
  }
  parts.push(item.name);
  let line = parts.join(" ");
  if (item.note) line += ` (${item.note})`;
  return line;
}

/** Builds a checkbox-style plain-text list grouped by aisle, ready to paste into Notes/Reminders. */
export function buildListText(items: Ingredient[]): string {
  const unchecked = items.filter((i) => !i.checked);
  const sections: string[] = [];

  for (const aisle of AISLES) {
    const aisleItems = unchecked.filter((i) => i.aisle === aisle);
    if (aisleItems.length === 0) continue;
    sections.push(`${aisle}`);
    for (const item of aisleItems) {
      sections.push(`☐ ${formatLine(item)}`);
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

export async function shareOrCopyList(items: Ingredient[]): Promise<"shared" | "copied"> {
  const text = buildListText(items);

  if (navigator.share) {
    try {
      await navigator.share({ title: "Grocery List", text });
      return "shared";
    } catch (err) {
      // User cancelled the share sheet — not an error, fall through to clipboard as backup.
    }
  }

  await navigator.clipboard.writeText(text);
  return "copied";
}

export function downloadListAsText(items: Ingredient[]): void {
  const text = buildListText(items);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grocery-list-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
