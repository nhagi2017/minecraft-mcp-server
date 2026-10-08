import { z } from "zod";
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals, Movements } = pathfinderPkg;
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import type { Block } from 'prismarine-block';
import type { Item } from 'prismarine-item';
import { ToolFactory } from '../tool-factory.js';
import { log } from '../logger.js';

const MAX_BLOCKS = 64;
const REACH = 4.5;
const PICKUP_RADIUS = 8;
const PICKUP_WALK_MS = 5000;
const FLUIDS = new Set(['water', 'lava', 'bubble_column']);
const AIR = new Set(['air', 'cave_air', 'void_air']);
const NEIGHBORS = [
  new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0),
  new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)
];

export const isFluid = (block: Block | null): boolean =>
  Boolean(block) && (FLUIDS.has(block!.name) || String(block!.getProperties?.().waterlogged) === 'true');

/** The fluid touching pos (breaking the block there would let it flow in), if any. */
export function fluidNeighbor(bot: mineflayer.Bot, pos: Vec3): Block | null {
  for (const d of NEIGHBORS) {
    const neighbor = bot.blockAt(pos.plus(d));
    if (isFluid(neighbor)) return neighbor;
  }
  return null;
}

/**
 * The fastest tool in the inventory that still gets the block's drop: null when bare hands are
 * as good as anything held, undefined when the block needs a tool the bot doesn't have.
 */
export function chooseTool(block: Block, items: Item[]): Item | null | undefined {
  const harvestable = (item: Item | null) => block.canHarvest(item ? item.type : null);
  const digTime = (item: Item | null) => block.digTime(item ? item.type : null, false, false, false, [], []);
  let best: Item | null | undefined = harvestable(null) ? null : undefined;
  let bestTime = best === null ? digTime(null) : Infinity;
  for (const item of items) {
    if (!harvestable(item)) continue;
    const time = digTime(item);
    if (time < bestTime) {
      best = item;
      bestTime = time;
    }
  }
  return best;
}

const durabilityLeft = (item: Item) =>
  item.maxDurability ? `${item.maxDurability - (item.durabilityUsed ?? 0)}/${item.maxDurability}` : undefined;

const countItems = (bot: mineflayer.Bot) => {
  const counts = new Map<string, number>();
  for (const item of bot.inventory.items()) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  return counts;
};

async function waitUntilGone(bot: mineflayer.Bot, pos: Vec3): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const block = bot.blockAt(pos);
    if (!block || AIR.has(block.name)) return true;
    await bot.waitForTicks(2);
  }
  return false;
}

// Walks toward goal for at most ms, then gives up: true if the walk finished, false on timeout.
// Clears its timer either way, so a walk that finished early can't cancel whatever the
// pathfinder is asked to do next.
async function walkFor(bot: mineflayer.Bot, goal: pathfinderPkg.goals.Goal, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      bot.pathfinder.setGoal(null);
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([bot.pathfinder.goto(goal).then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const fmt = (p: Vec3) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;

// Walks into the cell of each dropped item near the bot (standing beside one isn't always close
// enough, e.g. when it lies in a hole), without digging or building on the way. Returns a note
// for each drop it saw but couldn't collect, saying why, as the server's log isn't visible.
async function pickUpDrops(bot: mineflayer.Bot): Promise<{ seen: number, missed: string[] }> {
  const previous = bot.pathfinder.movements;
  const noDigging = new Movements(bot, minecraftData(bot.version));
  Object.assign(noDigging, { canDig: false, allow1by1towers: false, allowParkour: false, scafoldingBlocks: [] });
  bot.pathfinder.setMovements(noDigging);
  const seen = new Set<number>();
  const missed = new Map<number, string>();
  try {
    for (let round = 0; round < 3; round++) {
      const drops = Object.values(bot.entities).filter((e) =>
        e.name === 'item' && e.position.distanceTo(bot.entity.position) <= PICKUP_RADIUS);
      if (drops.length === 0) break;
      for (const drop of drops) {
        seen.add(drop.id);
        if (!bot.entities[drop.id]) continue; // already picked up on the way
        const cell = drop.position.floored();
        let outcome: string;
        try {
          outcome = (await walkFor(bot, new goals.GoalBlock(cell.x, cell.y, cell.z), PICKUP_WALK_MS))
            ? `walked to ${fmt(bot.entity.position)} but it was still there`
            : `timed out walking from ${fmt(bot.entity.position)}`;
        } catch (error) {
          outcome = `no path from ${fmt(bot.entity.position)}: ${error instanceof Error ? error.message : error}`;
          log('warn', `Could not reach dropped item at ${cell}: ${outcome}`);
        }
        await bot.waitForTicks(4);
        if (bot.entities[drop.id]) missed.set(drop.id, `item at ${fmt(drop.position)}: ${outcome}`);
        else missed.delete(drop.id);
      }
      await bot.waitForTicks(10);
    }
  } finally {
    bot.pathfinder.setGoal(null);
    bot.pathfinder.setMovements(previous);
  }
  // A later round may have collected one an earlier round missed.
  return { seen: seen.size, missed: [...missed].filter(([id]) => bot.entities[id]).map(([, note]) => note) };
}

export function registerMiningTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  factory.registerTool(
    "mine-blocks",
    "Mine a list of blocks in order, each with the fastest held tool that still gets its drop " +
    "(equipped and checked before every block), then walk over the drops to pick them up. " +
    "Never walks to reach a block: ones out of reach are skipped. Skips blocks next to water or lava, " +
    "and stops at the first block no tool in the inventory can harvest (rather than mining it for nothing).",
    {
      blocks: z.array(z.object({
        x: z.coerce.number(),
        y: z.coerce.number(),
        z: z.coerce.number()
      })).min(1).max(MAX_BLOCKS).describe(`Block positions to mine, in order (up to ${MAX_BLOCKS})`),
      pickUp: z.boolean().optional().describe("Walk over the drops afterwards to collect them (default: true)")
    },
    async ({ blocks, pickUp = true }: { blocks: { x: number, y: number, z: number }[], pickUp?: boolean }) => {
      const bot = getBot();
      const before = countItems(bot);
      const mined = new Map<string, number>();
      const toolsUsed = new Map<string, Item>();
      const skipped: string[] = [];
      let stoppedAt: string | undefined;

      for (const { x, y, z } of blocks) {
        const pos = new Vec3(x, y, z).floored();
        const at = `(${pos.x}, ${pos.y}, ${pos.z})`;
        const block = bot.blockAt(pos);
        if (!block) { skipped.push(`${at} not loaded`); continue; }
        if (AIR.has(block.name)) continue;
        if (isFluid(block)) { skipped.push(`${at} is ${block.name}`); continue; }
        const fluid = fluidNeighbor(bot, pos);
        if (fluid) { skipped.push(`${at} ${block.name}: ${fluid.name} next to it`); continue; }
        if (bot.entity.position.offset(0, bot.entity.height * 0.9, 0).distanceTo(pos.offset(0.5, 0.5, 0.5)) > REACH) {
          skipped.push(`${at} ${block.name}: out of reach`);
          continue;
        }

        const tool = chooseTool(block, bot.inventory.items());
        if (tool === undefined) {
          stoppedAt = `${at} ${block.name}: no tool in the inventory can harvest it`;
          break;
        }
        if (tool) {
          await bot.equip(tool, 'hand');
          if (bot.heldItem?.type !== tool.type) {
            stoppedAt = `${at} ${block.name}: could not equip ${tool.name}`;
            break;
          }
          toolsUsed.set(tool.name, tool);
        } else if (bot.heldItem) {
          await bot.unequip('hand');
        }

        await bot.dig(block, true);
        if (!(await waitUntilGone(bot, pos))) {
          skipped.push(`${at} ${block.name}: the server did not break it`);
          continue;
        }
        mined.set(block.name, (mined.get(block.name) ?? 0) + 1);
      }

      const pickup = pickUp && mined.size > 0 ? await pickUpDrops(bot) : undefined;

      const after = countItems(bot);
      const gained = [...after]
        .map(([name, n]) => [name, n - (before.get(name) ?? 0)] as const)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name} x${n}`);
      const tools = [...toolsUsed.keys()].map((name) => {
        const left = bot.inventory.items().filter((i) => i.name === name);
        return left.length === 0
          ? `${name}: none left`
          : `${name}: ${left.length} left (durability ${left.map(durabilityLeft).join(', ')})`;
      });

      const lines = [
        `Mined: ${[...mined].map(([name, n]) => `${name} x${n}`).join(', ') || 'nothing'}`,
        `Picked up: ${gained.join(', ') || 'nothing'}`
      ];
      if (pickup) {
        lines.push(`Drops seen nearby: ${pickup.seen}`);
        if (pickup.missed.length) lines.push(`Drops left behind:\n${pickup.missed.map((s) => `- ${s}`).join('\n')}`);
      }
      if (tools.length) lines.push(`Tools: ${tools.join('; ')}`);
      if (skipped.length) lines.push(`Skipped:\n${skipped.map((s) => `- ${s}`).join('\n')}`);
      if (stoppedAt) lines.push(`Stopped at ${stoppedAt}`);
      return factory.createResponse(lines.join('\n'));
    }
  );
}
