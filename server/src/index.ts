import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { parseRecipeImage } from "./parseRecipe.js";
import { mergeIngredients, removeRecipeFromList } from "./merge.js";
import type { Ingredient, ParsedIngredient } from "./types.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Accepts a photo + the current list (as JSON in the "list" field), returns the merged list.
app.post("/api/scan", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo uploaded" });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    }

    const mediaType = req.file.mimetype;
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(mediaType)) {
      return res.status(400).json({ error: `Unsupported image type: ${mediaType}` });
    }

    const base64 = req.file.buffer.toString("base64");
    const parsed = await parseRecipeImage(base64, mediaType as (typeof allowed)[number] as any);

    let currentList: Ingredient[] = [];
    if (typeof req.body.list === "string" && req.body.list.length > 0) {
      try {
        currentList = JSON.parse(req.body.list);
      } catch {
        currentList = [];
      }
    }

    const merged = mergeIngredients(currentList, parsed.ingredients, parsed.recipeName);

    // Return the raw per-recipe ingredients too, so the client can save this as a
    // reusable "recipe" (for the recipe-photo review view and favorites/re-add flow)
    // without needing to re-run the vision model later.
    res.json({ recipeName: parsed.recipeName, ingredients: parsed.ingredients, list: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Re-merges a previously-parsed recipe's ingredients into the current list, without
// touching the vision model. Used for "add this favorite recipe to my list again".
app.post("/api/merge", (req, res) => {
  try {
    const { list, ingredients, recipeName } = req.body as {
      list?: Ingredient[];
      ingredients?: ParsedIngredient[];
      recipeName?: string;
    };

    if (!Array.isArray(ingredients) || typeof recipeName !== "string") {
      return res.status(400).json({ error: "Expected { list, ingredients, recipeName }" });
    }

    const merged = mergeIngredients(Array.isArray(list) ? list : [], ingredients, recipeName);
    res.json({ list: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Removes a recipe's contribution from the list, precisely un-merging shared quantities
// rather than guessing. Used for "remove this recipe from my list".
app.post("/api/remove-recipe", (req, res) => {
  try {
    const { list, recipeName } = req.body as { list?: Ingredient[]; recipeName?: string };

    if (!Array.isArray(list) || typeof recipeName !== "string") {
      return res.status(400).json({ error: "Expected { list, recipeName }" });
    }

    const updated = removeRecipeFromList(list, recipeName);
    res.json({ list: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
  console.log(`Grocery scanner server listening on http://localhost:${PORT}`);
});
