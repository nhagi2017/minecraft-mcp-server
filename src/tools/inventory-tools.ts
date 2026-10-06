import { z } from "zod";
import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';
import { findMatch, itemCountSchema, type ItemCountArgs } from './item-utils.js';

interface InventoryItem {
  name: string;
  count: number;
  slot: number;
}

export function registerInventoryTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  factory.registerTool(
    "list-inventory",
    "List all items in the bot's inventory",
    {},
    async () => {
      const bot = getBot();
      const items = bot.inventory.items();
      const itemList: InventoryItem[] = items.map((item) => ({
        name: item.name,
        count: item.count,
        slot: item.slot
      }));

      if (items.length === 0) {
        return factory.createResponse("Inventory is empty");
      }

      let inventoryText = `Found ${items.length} items in inventory:\n\n`;
      itemList.forEach(item => {
        inventoryText += `- ${item.name} (x${item.count}) in slot ${item.slot}\n`;
      });

      return factory.createResponse(inventoryText);
    }
  );

  factory.registerTool(
    "find-item",
    "Find a specific item in the bot's inventory",
    {
      nameOrType: z.string().describe("Name or type of item to find")
    },
    async ({ nameOrType }) => {
      const bot = getBot();
      const item = findMatch(bot.inventory.items(), nameOrType)?.item;

      if (item) {
        return factory.createResponse(`Found ${item.count} ${item.name} in inventory (slot ${item.slot})`);
      } else {
        return factory.createResponse(`Couldn't find any item matching '${nameOrType}' in inventory`);
      }
    }
  );

  factory.registerTool(
    "equip-item",
    "Equip a specific item",
    {
      itemName: z.string().describe("Name of the item to equip"),
      destination: z.string().optional().describe("Where to equip the item (default: 'hand')")
    },
    async ({ itemName, destination = 'hand' }) => {
      const bot = getBot();
      const item = findMatch(bot.inventory.items(), itemName)?.item;

      if (!item) {
        return factory.createResponse(`Couldn't find any item matching '${itemName}' in inventory`);
      }

      await bot.equip(item, destination as mineflayer.EquipmentDestination);
      return factory.createResponse(`Equipped ${item.name} to ${destination}`);
    }
  );

  factory.registerTool(
    "drop-item",
    "Drop items from the bot's inventory in the direction it is facing (use look-at first to aim). " +
      "Dropped items can be picked back up by the bot after a moment if it stays close to them.",
    itemCountSchema("drop"),
    async ({ itemName, count }: ItemCountArgs) => {
      const bot = getBot();
      const match = findMatch(bot.inventory.items(), itemName, count);

      if (!match) {
        return factory.createResponse(`Couldn't find any item matching '${itemName}' in inventory`);
      }

      const { item, amount } = match;

      await bot.toss(item.type, item.metadata ?? null, amount);
      return factory.createResponse(`Dropped ${amount} ${item.name}`);
    }
  );

  factory.registerTool(
    "use-item",
    "Use (right-click) the item the bot is holding, in the direction it is facing (use look-at first to aim). " +
      "Plants such as short grass in the line of sight, including one the bot stands in, block buckets. " +
      "Food and drinks in the main hand are consumed until finished. " +
      "For items that must be held down, such as a bow, crossbow, trident or shield, pass holdSeconds.",
    {
      offHand: z.boolean().optional().describe("Use the item in the off hand instead of the main hand (default: false)"),
      holdSeconds: z.number().positive().max(10).optional()
        .describe("Keep the item in use for this many seconds, then release it (e.g. 1 to fully draw a bow)")
    },
    async ({ offHand = false, holdSeconds }: { offHand?: boolean; holdSeconds?: number }) => {
      const bot = getBot();
      const item = offHand ? bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')] : bot.heldItem;

      if (!item) {
        return factory.createResponse(`The bot is not holding anything in its ${offHand ? 'off hand' : 'main hand'}`);
      }

      if (holdSeconds !== undefined) {
        bot.activateItem(offHand);
        await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
        bot.deactivateItem();
        return factory.createResponse(`Used ${item.name} for ${holdSeconds}s`);
      }

      if (!offHand && isConsumable(bot, item.name)) {
        await bot.consume();
        return factory.createResponse(`Consumed ${item.name}`);
      }

      bot.activateItem(offHand);
      return factory.createResponse(`Used ${item.name}`);
    }
  );
}

// Drinkable items that mineflayer's consume() handles but the registry doesn't list as food
const DRINKS = ['potion', 'milk_bucket'];

function isConsumable(bot: mineflayer.Bot, itemName: string): boolean {
  return DRINKS.includes(itemName) || itemName in bot.registry.foodsByName;
}
