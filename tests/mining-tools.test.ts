import test from 'ava';
import sinon from 'sinon';
import prismarineRegistry from 'prismarine-registry';
import prismarineBlock from 'prismarine-block';
import prismarineItem from 'prismarine-item';
import { Vec3 } from 'vec3';
import { chooseTool, fluidNeighbor, registerMiningTools } from '../src/tools/mining-tools.js';
import { patchDigSpeeds } from '../src/dig-speeds.js';
import { ToolFactory } from '../src/tool-factory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BotConnection } from '../src/bot-connection.js';
import type mineflayer from 'mineflayer';
import type { Block as BlockType } from 'prismarine-block';

const registry = prismarineRegistry('1.21.11');
const Block = prismarineBlock(registry);
const Item = prismarineItem(registry);
patchDigSpeeds(registry as unknown as mineflayer.Bot['registry']);

const block = (name: string) => Block.fromStateId(registry.blocksByName[name].defaultState, 0);
const item = (name: string) => new Item(registry.itemsByName[name].id, 1);

test('chooseTool picks the fastest tool that harvests the block', (t) => {
  const tools = [item('stone_pickaxe'), item('copper_pickaxe'), item('dirt')];
  t.is(chooseTool(block('iron_ore'), tools)?.name, 'copper_pickaxe');
});

test('chooseTool uses a shovel for dirt and an axe for logs', (t) => {
  const tools = [item('stone_pickaxe'), item('copper_shovel'), item('copper_axe')];
  t.is(chooseTool(block('dirt'), tools)?.name, 'copper_shovel');
  t.is(chooseTool(block('oak_log'), tools)?.name, 'copper_axe');
});

test('chooseTool returns undefined when nothing held can harvest the block', (t) => {
  t.is(chooseTool(block('iron_ore'), [item('dirt'), item('copper_shovel')]), undefined);
  t.is(chooseTool(block('stone'), []), undefined);
});

test('chooseTool returns null when bare hands are as good as anything held', (t) => {
  t.is(chooseTool(block('dirt'), [item('cobblestone')]), null);
});

test('fluidNeighbor finds water or lava touching the block', (t) => {
  const lava = block('lava');
  const stone = block('stone');
  const bot = {
    blockAt: (p: Vec3) => (p.equals(new Vec3(1, 64, 0)) ? lava : stone)
  } as unknown as mineflayer.Bot;
  t.is(fluidNeighbor(bot, new Vec3(0, 64, 0))?.name, 'lava');
  t.is(fluidNeighbor(bot, new Vec3(5, 64, 5)), null);
});

function setUp(bot: Partial<mineflayer.Bot>) {
  const mockServer = { tool: sinon.stub() } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  registerMiningTools(new ToolFactory(mockServer, mockConnection), () => bot as mineflayer.Bot);
  const call = (mockServer.tool as sinon.SinonStub).getCalls().find((c) => c.args[0] === 'mine-blocks');
  return call!.args[3] as (args: unknown) => Promise<{ content: { text: string }[] }>;
}

/**
 * A bot standing at (0.5, 64, 0.5) holding a copper pickaxe, next to an iron ore at orePos in a world
 * of stone below y 64 and air above. Digging the ore drops item entity 7 at dropPos.
 */
function miningBot({ orePos, dropPos, goto = sinon.stub().resolves() }: { orePos: Vec3, dropPos: Vec3, goto?: sinon.SinonStub }) {
  const pickaxe = item('copper_pickaxe');
  let ore: BlockType = block('iron_ore');
  const entities: Record<number, unknown> = {};
  const bot: Partial<mineflayer.Bot> = {
    version: '1.21.11',
    registry,
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 } as mineflayer.Bot['entity'],
    entities: entities as mineflayer.Bot['entities'],
    inventory: { items: () => [pickaxe] } as unknown as mineflayer.Bot['inventory'],
    heldItem: null,
    blockAt: ((p: Vec3) => {
      const b = p.equals(orePos) ? ore : block(p.y < 64 ? 'stone' : 'air');
      b.position = p;
      return b;
    }) as mineflayer.Bot['blockAt'],
    equip: sinon.stub().callsFake(async () => { bot.heldItem = pickaxe; }),
    dig: sinon.stub().callsFake(async () => {
      ore = block('air');
      entities[7] = { id: 7, name: 'item', position: dropPos };
    }),
    waitForTicks: sinon.stub().resolves(),
    pathfinder: {
      goto, setGoal: sinon.stub(), stop: sinon.stub(), movements: {}, setMovements: sinon.stub()
    } as unknown as mineflayer.Bot['pathfinder']
  };
  return { bot, entities };
}

test('mine-blocks equips the chosen tool before each block and reports what it mined', async (t) => {
  const { bot } = miningBot({ orePos: new Vec3(0, 64, 1), dropPos: new Vec3(0.5, 64, 1.5) });
  const run = setUp(bot);

  const result = await run({ blocks: [{ x: 0, y: 64, z: 1 }], pickUp: false });

  t.true((bot.equip as sinon.SinonStub).calledBefore(bot.dig as sinon.SinonStub));
  t.true(result.content[0].text.includes('Mined: iron_ore x1'));
});

test('mine-blocks walks into the cell of each drop and leaves no timer to cancel a later walk', async (t) => {
  const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const goto = sinon.stub();
    const { bot, entities } = miningBot({ orePos: new Vec3(0, 63, 1), dropPos: new Vec3(0.4, 63, 1.6), goto });
    goto.callsFake(async () => { delete entities[7]; });
    const run = setUp(bot);

    await run({ blocks: [{ x: 0, y: 63, z: 1 }] });
    const goal = goto.firstCall.args[0];
    const stopsAfterRun = (bot.pathfinder!.stop as sinon.SinonStub).callCount;
    await clock.tickAsync(10000);

    t.deepEqual([goal.x, goal.y, goal.z], [0, 63, 1]);
    t.is((bot.pathfinder!.stop as sinon.SinonStub).callCount, stopsAfterRun);
  } finally {
    clock.restore();
  }
});

test('mine-blocks reports drops it could not reach and why', async (t) => {
  const { bot } = miningBot({
    orePos: new Vec3(0, 63, 1),
    dropPos: new Vec3(0.4, 63, 1.6),
    goto: sinon.stub().rejects(new Error('No path to the goal!'))
  });
  const run = setUp(bot);

  const text = (await run({ blocks: [{ x: 0, y: 63, z: 1 }] })).content[0].text;

  t.true(text.includes('Drops seen nearby: 1'));
  t.true(text.includes('item at (0.4, 63.0, 1.6): no path to next to it from (0.5, 64.0, 0.5)'));
});

test('mine-blocks does not mistake a walk that never moved for reaching the drop', async (t) => {
  // The pathfinder resolves goto without moving when it finds an empty path.
  const goto = sinon.stub().resolves();
  const { bot } = miningBot({ orePos: new Vec3(2, 64, 2), dropPos: new Vec3(2.5, 64, 2.5), goto });
  const run = setUp(bot);

  const text = (await run({ blocks: [{ x: 2, y: 64, z: 2 }] })).content[0].text;

  t.is(goto.firstCall.args[0].constructor.name, 'GoalBlock');
  t.is(goto.secondCall.args[0].constructor.name, 'GoalNear');
  t.true(text.includes('item at (2.5, 64.0, 2.5): no path to next to it from (0.5, 64.0, 0.5)'));
});

test('mine-blocks stops instead of mining an ore it cannot harvest', async (t) => {
  const { bot } = miningBot({ orePos: new Vec3(0, 64, 1), dropPos: new Vec3(0.5, 64, 1.5) });
  bot.inventory = { items: () => [item('copper_shovel')] } as unknown as mineflayer.Bot['inventory'];
  const run = setUp(bot);

  const result = await run({ blocks: [{ x: 0, y: 64, z: 1 }] });

  t.false((bot.dig as sinon.SinonStub).called);
  t.true(result.content[0].text.includes('no tool in the inventory can harvest it'));
});
