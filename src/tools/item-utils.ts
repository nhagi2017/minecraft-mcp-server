import { z } from "zod";
import type { Item } from 'prismarine-item';

export type ItemCountArgs = { itemName: string; count?: number };

export const itemCountSchema = (verb: string) => ({
  itemName: z.string().trim().min(1).describe(`Name of the item to ${verb}`),
  count: z.number().int().positive().optional().describe(`Amount to ${verb} (default: all matching items)`)
});

/**
 * Finds the item whose name matches exactly, falling back to the first partial match.
 * `amount` is the requested count capped at the total across every stack of that item
 * type (all of them when count is omitted).
 */
export function findMatch(
  items: Item[],
  itemName: string,
  count?: number
): { item: Item; amount: number } | undefined {
  const needle = itemName.trim().toLowerCase();
  const item = items.find((candidate) => candidate.name === needle)
    ?? items.find((candidate) => candidate.name.includes(needle));
  if (!item) {
    return undefined;
  }
  const total = items
    .filter((candidate) => candidate.type === item.type)
    .reduce((sum, candidate) => sum + candidate.count, 0);
  return { item, amount: Math.min(count ?? total, total) };
}
