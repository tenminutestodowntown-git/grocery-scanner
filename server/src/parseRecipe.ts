import Anthropic from "@anthropic-ai/sdk";
import { AISLES } from "./aisles.js";
import type { ParseRecipeResponse } from "./types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a precise recipe-ingredient extractor for a grocery list app.
You will be shown a photo of a cookbook page (or similar recipe source). Extract ONLY the ingredients list
(ignore instructions/method text, headnotes, and serving suggestions unless they name an ingredient).

For each ingredient, normalize it into:
- name: canonical singular display name (e.g. "Cucumber" not "cucumbers", "Egg" not "eggs"). Strip prep instructions
  like "diced", "finely chopped", "melted" out of the name and put them in "note" instead. Keep the name generic
  enough to match across recipes (e.g. "Yellow onion" -> "Onion" unless the recipe specifically depends on the variety).
- quantity: a single number if expressible (e.g. 2, 0.5, 1.5). If a range is given (e.g. "2-3 cloves garlic"), use the
  higher number. If no sensible single number exists (e.g. "salt to taste", "a pinch"), use null.
- unit: a standard unit abbreviation/word if the recipe uses one for volume/weight (cup, tbsp, tsp, oz, lb, g, kg, ml, l).
  For countable whole items (e.g. "2 cucumbers", "3 eggs"), set unit to null and put the count in quantity.
- note: any qualifier worth keeping (e.g. "to taste", "diced", "room temperature", "ripe"), or null if none.
- aisle: pick the SINGLE best match from this exact list (copy the string exactly):
${AISLES.map((a) => `  - "${a}"`).join("\n")}

Also return recipeName: a short human name for the recipe/dish (from the page title/heading if visible, otherwise a
reasonable short description like "Page recipe" or infer from the ingredients, e.g. "Chicken stir-fry").

Respond with ONLY valid JSON matching this exact shape, no markdown fences, no commentary:
{
  "recipeName": string,
  "ingredients": [
    { "name": string, "quantity": number | null, "unit": string | null, "note": string | null, "aisle": string }
  ]
}`;

export async function parseRecipeImage(
  base64Image: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<ParseRecipeResponse> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: "text",
            text: "Extract the ingredient list from this recipe photo as JSON per the system instructions.",
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from vision model");
  }

  let raw = textBlock.text.trim();
  // Strip accidental markdown code fences just in case.
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }

  let parsed: ParseRecipeResponse;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse model response as JSON: ${raw.slice(0, 500)}`);
  }

  if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) {
    throw new Error("Model response missing ingredients array");
  }

  return parsed;
}
