import test from 'ava';
import sinon from 'sinon';
import { Vec3 } from 'vec3';
import { registerContainerTools } from '../src/tools/container-tools.js';
import { ToolFactory } from '../src/tool-factory.js';
import { BotConnection } from '../src/bot-connection.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type mineflayer from 'mineflayer';
import type { Item } from 'prismarine-item';

const createMockItem = (fields: {
  name: string;
  count: number;
  type: number;
  metadata: number;
}): Item => fields as unknown as Item;

const createContainer = (items: Item[] = []) => ({
  containerItems: sinon.stub().returns(items),
  deposit: sinon.stub().resolves(),
  withdraw: sinon.stub().resolves(),
  close: sinon.stub()
});

const setup = (options: {
  blockName?: string | null;
  botPosition?: Vec3;
  inventoryItems?: Item[];
  container?: ReturnType<typeof createContainer>;
} = {}) => {
  const mockServer = { tool: sinon.stub() } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);
  const container = options.container ?? createContainer();
  const blockName = options.blockName === undefined ? 'chest' : options.blockName;

  const mockBot = {
    blockAt: sinon.stub().returns(blockName ? { name: blockName } : null),
    entity: { position: options.botPosition ?? new Vec3(1, 2, 2) },
    inventory: { items: () => options.inventoryItems ?? [] },
    openContainer: sinon.stub().resolves(container)
  } as unknown as Partial<mineflayer.Bot>;
  const getBot = () => mockBot as mineflayer.Bot;

  registerContainerTools(factory, getBot);

  const getExecutor = (name: string) => {
    const call = (mockServer.tool as sinon.SinonStub).getCalls().find(c => c.args[0] === name);
    return call!.args[3];
  };

  return { mockServer, mockBot, container, getExecutor };
};

test('registerContainerTools registers list, deposit and withdraw tools', (t) => {
  const { mockServer } = setup();
  const names = (mockServer.tool as sinon.SinonStub).getCalls().map(call => call.args[0]);
  t.deepEqual(names, ['list-container', 'deposit-item', 'withdraw-item']);
});

test('list-container returns error when no container block found', async (t) => {
  const { getExecutor, mockBot } = setup({ blockName: 'stone' });
  const result = await getExecutor('list-container')({ x: 1, y: 2, z: 3 });
  t.true(result.content[0].text.includes('No container block found'));
  t.false((mockBot.openContainer as sinon.SinonStub).called);
});

test('list-container accepts shulker boxes', async (t) => {
  const { getExecutor, mockBot } = setup({ blockName: 'red_shulker_box' });
  await getExecutor('list-container')({ x: 1, y: 2, z: 3 });
  t.true((mockBot.openContainer as sinon.SinonStub).calledOnce);
});

test('list-container returns error when container is too far away', async (t) => {
  const { getExecutor, mockBot } = setup({ botPosition: new Vec3(20, 2, 3) });
  const result = await getExecutor('list-container')({ x: 1, y: 2, z: 3 });
  t.true(result.content[0].text.includes('too far away'));
  t.false((mockBot.openContainer as sinon.SinonStub).called);
});

test('list-container reports empty container', async (t) => {
  const { getExecutor, container } = setup();
  const result = await getExecutor('list-container')({ x: 1, y: 2, z: 3 });
  t.true(result.content[0].text.includes('is empty'));
  t.true(container.close.calledOnce);
});

test('list-container sums items by name', async (t) => {
  const container = createContainer([
    createMockItem({ name: 'cobblestone', count: 64, type: 1, metadata: 0 }),
    createMockItem({ name: 'cobblestone', count: 10, type: 1, metadata: 0 }),
    createMockItem({ name: 'oak_log', count: 3, type: 2, metadata: 0 })
  ]);
  const { getExecutor } = setup({ container });
  const result = await getExecutor('list-container')({ x: 1, y: 2, z: 3 });
  const text = result.content[0].text;
  t.true(text.includes('cobblestone (x74)'));
  t.true(text.includes('oak_log (x3)'));
  t.true(container.close.calledOnce);
});

test('deposit-item deposits all matching items by default', async (t) => {
  const { getExecutor, container } = setup({
    inventoryItems: [
      createMockItem({ name: 'cobblestone', count: 64, type: 1, metadata: 0 }),
      createMockItem({ name: 'cobblestone', count: 5, type: 1, metadata: 0 })
    ]
  });
  const result = await getExecutor('deposit-item')({ x: 1, y: 2, z: 3, itemName: 'cobblestone' });
  t.true(result.content[0].text.includes('Deposited 69 cobblestone'));
  t.true(container.deposit.calledOnceWith(1, 0, 69));
  t.true(container.close.calledOnce);
});

test('deposit-item caps count at the amount in inventory', async (t) => {
  const { getExecutor, container } = setup({
    inventoryItems: [createMockItem({ name: 'coal', count: 3, type: 5, metadata: 0 })]
  });
  await getExecutor('deposit-item')({ x: 1, y: 2, z: 3, itemName: 'coal', count: 10 });
  t.true(container.deposit.calledOnceWith(5, 0, 3));
});

test('deposit-item returns error when item is not in inventory', async (t) => {
  const { getExecutor, mockBot } = setup();
  const result = await getExecutor('deposit-item')({ x: 1, y: 2, z: 3, itemName: 'diamond' });
  t.true(result.content[0].text.includes("Couldn't find any item matching 'diamond'"));
  t.false((mockBot.openContainer as sinon.SinonStub).called);
});

test('withdraw-item withdraws requested count', async (t) => {
  const container = createContainer([
    createMockItem({ name: 'iron_ingot', count: 20, type: 7, metadata: 0 })
  ]);
  const { getExecutor } = setup({ container });
  const result = await getExecutor('withdraw-item')({ x: 1, y: 2, z: 3, itemName: 'iron', count: 8 });
  t.true(result.content[0].text.includes('Withdrew 8 iron_ingot'));
  t.true(container.withdraw.calledOnceWith(7, 0, 8));
  t.true(container.close.calledOnce);
});

test('withdraw-item returns error when item is not in container', async (t) => {
  const { getExecutor, container } = setup();
  const result = await getExecutor('withdraw-item')({ x: 1, y: 2, z: 3, itemName: 'diamond' });
  t.true(result.content[0].text.includes("Couldn't find any item matching 'diamond' in chest"));
  t.false(container.withdraw.called);
  t.true(container.close.calledOnce);
});

test('container is closed even when deposit fails', async (t) => {
  const container = createContainer();
  container.deposit.rejects(new Error('destination full'));
  const { getExecutor } = setup({
    container,
    inventoryItems: [createMockItem({ name: 'dirt', count: 1, type: 3, metadata: 0 })]
  });
  const result = await getExecutor('deposit-item')({ x: 1, y: 2, z: 3, itemName: 'dirt' });
  t.true(result.isError);
  t.true(result.content[0].text.includes('destination full'));
  t.true(container.close.calledOnce);
});
