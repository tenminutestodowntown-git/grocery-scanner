import Anthropic from "@anthropic-ai/sdk";
import { AISLES } from "./aisles.js";
import type { ParsePantryResponse } from "./types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a precise fridge/pantry inventory scanner for a grocery list app. You will be shown a
photo of the inside of someone's fridge, freezer, or a pantry/cupboard shelf. Identify each distinct food or grocery
item you can actually see — the goal is to help the person avoid buying something they already have.

For each item, return:
- name: a canonical singular display name matching how a shopping list would refer to it (e.g. "Milk", "Egg",
  "Ketchup", "Yellow onion"). Preserve a variety or color if it's clearly visible on the packaging (e.g. "Red onion"
  vs "Yellow onion") — otherwise keep it generic.
- quantity: a rough count ONLY if it's easily countable at a glance (e.g. 6 eggs in a carton, 3 apples). Otherwise null.
- unit: leave this null almost always. Only set it for a clearly-countable package unit worth noting (e.g. "carton",
  "jar", "bottle") — never guess a cooking unit like cups or grams from a photo.
- aisle: pick the SINGLE best match from this exact list (copy the string exactly):
${AISLES.map((a) => `  - "${a}"`).join("\n")}
- confidence: "high" when you can read a label or the item is unmistakable from its shape/color (a banana, an egg
  carton, a milk jug). "low" when you're guessing from packaging shape/color alone with no readable label (an
  unlabeled jar of something, a plain squeeze bottle, a generic container) — still make your best guess, just mark
  it low-confidence rather than skipping it.

Only list items you can actually identify with a real guess — skip anything totally unreadable (a blank opaque
container, something entirely blocked from view). Do not invent items that aren't visible. List each distinct item
once, even if you can see it more than once in the photo.

Respond with ONLY valid JSON matching this exact shape, no markdown fences, no commentary:
{
  "items": [
    { "name": string, "quantity": number | null, "unit": string | null, "aisle": string, "confidence": "high" | "low" }
  ]
}`;

export async function parsePantryImage(
  base64Image: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<ParsePantryResponse> {
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
            text: "Identify the fridge/pantry items visible in this photo as JSON per the system instructions.",
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
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }

  let parsed: ParsePantryResponse;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse model response as JSON: ${raw.slice(0, 500)}`);
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error("Model response missing items array");
  }

  return parsed;
}
