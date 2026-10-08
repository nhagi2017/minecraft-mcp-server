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

test('mine-blocks equips the chosen tool before each block and reports what it mined', async (t) => {
  const pickaxe = item('copper_pickaxe');
  const world = new Map<string, BlockType>([['0,64,1', block('iron_ore')]]);
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
  const blockAt = (p: Vec3) => {
    const b = world.get(key(p)) ?? block(p.y < 64 ? 'stone' : 'air');
    b.position = p;
    return b;
  };
  const bot: Partial<mineflayer.Bot> = {
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 } as mineflayer.Bot['entity'],
    inventory: { items: () => [pickaxe] } as unknown as mineflayer.Bot['inventory'],
    heldItem: null,
    blockAt: blockAt as mineflayer.Bot['blockAt'],
    equip: sinon.stub().callsFake(async () => { bot.heldItem = pickaxe; }),
    dig: sinon.stub().callsFake(async (b: BlockType) => { world.set(key(b.position), block('air')); }),
    waitForTicks: sinon.stub().resolves()
  };
  const run = setUp(bot);

  const result = await run({ blocks: [{ x: 0, y: 64, z: 1 }], pickUp: false });

  t.true((bot.equip as sinon.SinonStub).calledBefore(bot.dig as sinon.SinonStub));
  t.true(result.content[0].text.includes('Mined: iron_ore x1'));
});

test('mine-blocks walks into the cell of each drop and leaves no timer to cancel a later walk', async (t) => {
  const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pickaxe = item('copper_pickaxe');
    let ore: BlockType = block('iron_ore');
    const entities: Record<number, unknown> = {};
    const goto = sinon.stub().callsFake(async () => { delete entities[7]; });
    const setGoal = sinon.stub();
    const bot: Partial<mineflayer.Bot> = {
      version: '1.21.11',
      registry,
      entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 } as mineflayer.Bot['entity'],
      entities: entities as mineflayer.Bot['entities'],
      inventory: { items: () => [pickaxe] } as unknown as mineflayer.Bot['inventory'],
      heldItem: null,
      blockAt: ((p: Vec3) => {
        const b = p.equals(new Vec3(0, 63, 1)) ? ore : block(p.y < 63 ? 'stone' : 'air');
        b.position = p;
        return b;
      }) as mineflayer.Bot['blockAt'],
      equip: sinon.stub().callsFake(async () => { bot.heldItem = pickaxe; }),
      dig: sinon.stub().callsFake(async () => {
        ore = block('air');
        entities[7] = { id: 7, name: 'item', position: new Vec3(0.4, 63, 1.6) };
      }),
      waitForTicks: sinon.stub().resolves(),
      pathfinder: { goto, setGoal, movements: {}, setMovements: sinon.stub() } as unknown as mineflayer.Bot['pathfinder']
    };
    const run = setUp(bot);

    await run({ blocks: [{ x: 0, y: 63, z: 1 }] });
    const goal = goto.firstCall.args[0];
    const callsAfterRun = setGoal.callCount;
    await clock.tickAsync(10000);

    t.deepEqual([goal.x, goal.y, goal.z], [0, 63, 1]);
    t.is(setGoal.callCount, callsAfterRun);
  } finally {
    clock.restore();
  }
});

test('mine-blocks stops instead of mining an ore it cannot harvest', async (t) => {
  const bot: Partial<mineflayer.Bot> = {
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 } as mineflayer.Bot['entity'],
    inventory: { items: () => [item('copper_shovel')] } as unknown as mineflayer.Bot['inventory'],
    blockAt: ((p: Vec3) => (p.equals(new Vec3(0, 64, 1)) ? block('iron_ore') : block('stone'))) as mineflayer.Bot['blockAt'],
    dig: sinon.stub()
  };
  const run = setUp(bot);

  const result = await run({ blocks: [{ x: 0, y: 64, z: 1 }] });

  t.false((bot.dig as sinon.SinonStub).called);
  t.true(result.content[0].text.includes('no tool in the inventory can harvest it'));
});
