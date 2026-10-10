import Anthropic from "@anthropic-ai/sdk";
import { AISLES, AISLE_GUIDANCE, type Aisle } from "./aisles.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Same aisle list + guidance the recipe/pantry vision prompts use, so a manually-typed item
// lands in the same aisle it would have if it had been scanned.
const SYSTEM_PROMPT = `You categorize grocery items for a shopping list app. Given the name of one grocery item as a
person typed it, pick the SINGLE best grocery-store aisle for it from this exact list (copy the string exactly):
${AISLES.map((a) => `  - "${a}"`).join("\n")}
${AISLE_GUIDANCE}
If the name is unclear or doesn't match any aisle well, use "Other".`;

/** Best-guess aisle for a free-text item name (no image). Falls back to "Other" when the model
 * declines or returns something unparseable, so callers never have to handle a missing aisle. */
export async function categorizeItem(name: string): Promise<Aisle> {
  const message = await anthropic.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { aisle: { type: "string", enum: [...AISLES] } },
          required: ["aisle"],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Item: ${name}` }],
  });

  if (message.stop_reason === "refusal") return "Other";
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return "Other";
  try {
    const aisle = JSON.parse(text.text).aisle;
    return (AISLES as readonly string[]).includes(aisle) ? (aisle as Aisle) : "Other";
  } catch {
    return "Other";
  }
}
