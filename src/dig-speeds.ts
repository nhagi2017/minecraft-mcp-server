import type mineflayer from 'mineflayer';

type Materials = Record<string, Record<string, number>>;

const COPPER_TOOL_SPEED = 5;
const COPPER_TOOLS = ['copper_pickaxe', 'copper_shovel', 'copper_axe', 'copper_hoe'];

/**
 * Corrects two gaps in minecraft-data's tool speeds that make bot.dig wait far too long:
 * - Copper tools are listed at speed 1 (bare-hand speed) instead of 5, so a copper pickaxe
 *   mines stone about 3x slower than a stone pickaxe.
 * - Ores (material incorrect_for_*_tool) carry no pickaxe speeds at all, so they are timed
 *   as if mined by hand.
 * The registry's material objects are shared with prismarine-block, so patching them in place
 * fixes block.digTime everywhere. Remove once minecraft-data ships the right numbers.
 */
export function patchDigSpeeds(registry: mineflayer.Bot['registry']): void {
  const materials = (registry as unknown as { materials?: Materials }).materials;
  if (!materials) return;

  const copperIds = COPPER_TOOLS
    .map((name) => registry.itemsByName[name]?.id)
    .filter((id): id is number => id !== undefined);
  for (const [name, speeds] of Object.entries(materials)) {
    if (!name.includes('mineable/')) continue;
    for (const id of copperIds) {
      if (speeds[id] !== undefined && speeds[id] < COPPER_TOOL_SPEED) speeds[id] = COPPER_TOOL_SPEED;
    }
  }

  const pickaxeSpeeds = materials['mineable/pickaxe'];
  if (!pickaxeSpeeds) return;
  for (const [name, speeds] of Object.entries(materials)) {
    if (name.startsWith('incorrect_for_')) Object.assign(speeds, pickaxeSpeeds);
  }
}
