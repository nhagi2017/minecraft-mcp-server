import type { Item } from 'prismarine-item';

/** Finds the first item matching the name and totals every stack of that same item type. */
export function findMatch(items: Item[], itemName: string): { item: Item; total: number } | undefined {
  const needle = itemName.toLowerCase();
  const item = items.find((candidate) => candidate.name.includes(needle));
  if (!item) {
    return undefined;
  }
  const total = items
    .filter((candidate) => candidate.type === item.type)
    .reduce((sum, candidate) => sum + candidate.count, 0);
  return { item, total };
}
