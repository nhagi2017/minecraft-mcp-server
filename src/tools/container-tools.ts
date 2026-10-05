import { z } from "zod";
import mineflayer from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Item } from 'prismarine-item';
import { Vec3 } from 'vec3';
import { ToolFactory } from '../tool-factory.js';
import { coerceCoordinates } from './coordinate-utils.js';

const CONTAINER_BLOCKS = new Set([
  'chest',
  'trapped_chest',
  'barrel',
  'ender_chest',
  'hopper',
  'dispenser',
  'dropper'
]);

const MAX_INTERACT_DISTANCE = 4.5;

const coordinateSchema = {
  x: z.coerce.number().describe("X coordinate of the container"),
  y: z.coerce.number().describe("Y coordinate of the container"),
  z: z.coerce.number().describe("Z coordinate of the container")
};

function isContainerBlock(block: Block): boolean {
  return CONTAINER_BLOCKS.has(block.name) || block.name.endsWith('shulker_box');
}

function findMatchingItems(items: Item[], itemName: string): Item[] {
  const first = items.find((item) => item.name.includes(itemName.toLowerCase()));
  if (!first) {
    return [];
  }
  return items.filter((item) => item.type === first.type);
}

function sumCount(items: Item[]): number {
  return items.reduce((total, item) => total + item.count, 0);
}

export function registerContainerTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  const resolveContainerBlock = (
    x: number,
    y: number,
    z: number
  ): { block: Block } | { error: string } => {
    const bot = getBot();
    const pos = new Vec3(x, y, z);
    const block = bot.blockAt(pos);

    if (!block || !isContainerBlock(block)) {
      return { error: `No container block found at (${x}, ${y}, ${z})` };
    }

    const distance = bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5));
    if (distance > MAX_INTERACT_DISTANCE) {
      return {
        error: `Container at (${x}, ${y}, ${z}) is too far away (${distance.toFixed(1)} blocks). ` +
          `Move within ${MAX_INTERACT_DISTANCE} blocks first (e.g. with move-to-position).`
      };
    }

    return { block };
  };

  const withContainer = async <T>(
    block: Block,
    action: (container: mineflayer.Chest | mineflayer.Dispenser) => Promise<T>
  ): Promise<T> => {
    const container = await getBot().openContainer(block);
    try {
      return await action(container);
    } finally {
      try {
        container.close();
      } catch {
        // ignore
      }
    }
  };

  factory.registerTool(
    "list-container",
    "List the items inside a container block (chest, barrel, shulker box, etc.)",
    coordinateSchema,
    async ({ x, y, z }: { x: number; y: number; z: number }) => {
      ({ x, y, z } = coerceCoordinates(x, y, z));

      const resolved = resolveContainerBlock(x, y, z);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block } = resolved;

      return withContainer(block, async (container) => {
        const items = container.containerItems();
        if (items.length === 0) {
          return factory.createResponse(`${block.name} at (${x}, ${y}, ${z}) is empty`);
        }

        const totals = new Map<string, number>();
        for (const item of items) {
          totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
        }

        let text = `${block.name} at (${x}, ${y}, ${z}) contains ${totals.size} item types:\n\n`;
        for (const [name, count] of totals) {
          text += `- ${name} (x${count})\n`;
        }
        return factory.createResponse(text);
      });
    }
  );

  factory.registerTool(
    "deposit-item",
    "Put items from the bot's inventory into a container block",
    {
      ...coordinateSchema,
      itemName: z.string().trim().min(1).describe("Name of the item to deposit"),
      count: z.number().int().positive().optional().describe("Amount to deposit (default: all matching items)")
    },
    async ({ x, y, z, itemName, count }: {
      x: number;
      y: number;
      z: number;
      itemName: string;
      count?: number;
    }) => {
      ({ x, y, z } = coerceCoordinates(x, y, z));

      const resolved = resolveContainerBlock(x, y, z);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block } = resolved;

      const matches = findMatchingItems(getBot().inventory.items(), itemName);
      if (matches.length === 0) {
        return factory.createResponse(`Couldn't find any item matching '${itemName}' in inventory`);
      }

      const item = matches[0];
      const amount = Math.min(count ?? Infinity, sumCount(matches));

      return withContainer(block, async (container) => {
        await container.deposit(item.type, item.metadata ?? null, amount);
        return factory.createResponse(
          `Deposited ${amount} ${item.name} into ${block.name} at (${x}, ${y}, ${z})`
        );
      });
    }
  );

  factory.registerTool(
    "withdraw-item",
    "Take items out of a container block into the bot's inventory",
    {
      ...coordinateSchema,
      itemName: z.string().trim().min(1).describe("Name of the item to withdraw"),
      count: z.number().int().positive().optional().describe("Amount to withdraw (default: all matching items)")
    },
    async ({ x, y, z, itemName, count }: {
      x: number;
      y: number;
      z: number;
      itemName: string;
      count?: number;
    }) => {
      ({ x, y, z } = coerceCoordinates(x, y, z));

      const resolved = resolveContainerBlock(x, y, z);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block } = resolved;

      return withContainer(block, async (container) => {
        const matches = findMatchingItems(container.containerItems(), itemName);
        if (matches.length === 0) {
          return factory.createResponse(
            `Couldn't find any item matching '${itemName}' in ${block.name} at (${x}, ${y}, ${z})`
          );
        }

        const item = matches[0];
        const amount = Math.min(count ?? Infinity, sumCount(matches));

        await container.withdraw(item.type, item.metadata ?? null, amount);
        return factory.createResponse(
          `Withdrew ${amount} ${item.name} from ${block.name} at (${x}, ${y}, ${z})`
        );
      });
    }
  );
}
