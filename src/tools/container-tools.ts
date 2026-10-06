import { z } from "zod";
import mineflayer from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { ToolFactory } from '../tool-factory.js';
import { coerceCoordinates } from './coordinate-utils.js';
import { findMatch, itemCountSchema, type ItemCountArgs } from './item-utils.js';

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

type Coordinates = { x: number; y: number; z: number };
type TransferArgs = Coordinates & ItemCountArgs;

const transferSchema = (verb: string) => ({
  ...coordinateSchema,
  ...itemCountSchema(verb)
});

function isContainerBlock(block: Block): boolean {
  return CONTAINER_BLOCKS.has(block.name) || block.name.endsWith('shulker_box');
}

export function registerContainerTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  const resolveContainerBlock = (
    args: Coordinates
  ): { block: Block; x: number; y: number; z: number } | { error: string } => {
    const { x, y, z } = coerceCoordinates(args.x, args.y, args.z);
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

    return { block, x, y, z };
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
    async (args: Coordinates) => {
      const resolved = resolveContainerBlock(args);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block, x, y, z } = resolved;

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
    transferSchema("deposit"),
    async ({ itemName, count, ...coords }: TransferArgs) => {
      const resolved = resolveContainerBlock(coords);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block, x, y, z } = resolved;

      const match = findMatch(getBot().inventory.items(), itemName, count);
      if (!match) {
        return factory.createResponse(`Couldn't find any item matching '${itemName}' in inventory`);
      }

      const { item, amount } = match;

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
    transferSchema("withdraw"),
    async ({ itemName, count, ...coords }: TransferArgs) => {
      const resolved = resolveContainerBlock(coords);
      if ('error' in resolved) {
        return factory.createResponse(resolved.error);
      }
      const { block, x, y, z } = resolved;

      return withContainer(block, async (container) => {
        const match = findMatch(container.containerItems(), itemName, count);
        if (!match) {
          return factory.createResponse(
            `Couldn't find any item matching '${itemName}' in ${block.name} at (${x}, ${y}, ${z})`
          );
        }

        const { item, amount } = match;

        await container.withdraw(item.type, item.metadata ?? null, amount);
        return factory.createResponse(
          `Withdrew ${amount} ${item.name} from ${block.name} at (${x}, ${y}, ${z})`
        );
      });
    }
  );
}
