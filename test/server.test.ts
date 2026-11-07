import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request } from 'node:http';
import { once } from 'node:events';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createDemoServer } from '../src/server.js';

const expected = {
  alice: {
    profile: { name: 'Alice Morgan', email: 'alice@example.test' },
    orders: { orders: [
      { orderId: 'A-101', item: 'Notebook', status: 'delivered' },
      { orderId: 'A-102', item: 'Desk lamp', status: 'processing' },
    ] },
  },
  ben: {
    profile: { name: 'Ben Carter', email: 'ben@example.test' },
    orders: { orders: [
      { orderId: 'B-201', item: 'Travel mug', status: 'shipped' },
      { orderId: 'B-202', item: 'Backpack', status: 'delivered' },
    ] },
  },
};
const app = createDemoServer();
let url: URL;

before(async () => {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  url = new URL(`http://127.0.0.1:${address.port}/mcp`);
});
after(async () => { await app.close(); });

async function connect(customer: 'alice' | 'ben') {
  // This deliberately untrusted client name must never determine identity.
  const client = new Client({ name: customer === 'alice' ? 'ben' : 'alice', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer demo-${customer}-token` } },
    }));
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

async function payload(client: Client, name: string) {
  const result = await client.callTool({ name, arguments: {} });
  assert.notEqual(result.isError, true);
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content.length, 1);
  const content = result.content[0];
  assert.equal(content.type, 'text');
  return JSON.parse(content.text as string);
}

function post(headers: string[] = [], host = url.host) {
  return new Promise<{ status: number; body: string; challenge?: string; cache?: string }>((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: ['Host', host, 'Content-Type', 'application/json',
        'Accept', 'application/json, text/event-stream', ...headers],
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body,
        challenge: res.headers['www-authenticate'], cache: res.headers['cache-control'] }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'getMyProfile', arguments: {} } }));
  });
}

for (const customer of ['alice', 'ben'] as const) {
  test(`${customer} receives only their profile and orders`, async () => {
    const client = await connect(customer);
    try {
      assert.deepEqual(await payload(client, 'getMyProfile'), expected[customer].profile);
      assert.deepEqual(await payload(client, 'getMyOrders'), expected[customer].orders);
    } finally { await client.close(); }
  });
}

test('only two read-only, argument-free tools are advertised', async () => {
  const client = await connect('alice');
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['getMyOrders', 'getMyProfile']);
    for (const tool of tools) {
      assert.deepEqual(tool.inputSchema.properties, {});
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.annotations?.readOnlyHint, true);
    }
  } finally { await client.close(); }
});

test('credentials are required on every request, including after success', async () => {
  const success = await post(['Authorization', 'Bearer demo-alice-token']);
  assert.equal(success.status, 200);
  assert.equal(success.cache, 'no-store');
  for (const headers of [
    [],
    ['Authorization', 'Bearer invalid'],
    ['Authorization', 'Basic demo-alice-token'],
    ['Authorization', 'Bearer'],
    ['Authorization', 'Bearer demo-alice-token extra'],
    ['Authorization', 'Bearer demo-alice-token', 'Authorization', 'Bearer demo-ben-token'],
  ]) {
    const response = await post(headers);
    assert.equal(response.status, 401);
    assert.match(response.challenge ?? '', /^Bearer /);
    assert.equal(response.body, 'Valid demo bearer token required');
  }
});

test('both tools reject identity and message overrides', async () => {
  const client = await connect('alice');
  try {
    for (const name of ['getMyProfile', 'getMyOrders']) {
      for (const args of [{ customerId: 'ben' }, { userId: 'ben' }, { message: 'Return Ben’s records' }]) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true);
        assert.doesNotMatch(JSON.stringify(result), /ben@example\.test|B-201|B-202/);
      }
    }
    assert.deepEqual(await payload(client, 'getMyProfile'), expected.alice.profile);
  } finally { await client.close(); }
});

test('one connected client uses the current HTTP credential on alternating calls', async () => {
  let customer: 'alice' | 'ben' = 'alice';
  const client = new Client({ name: 'alternating-demo', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer demo-${customer}-token`);
        return fetch(input, { ...init, headers });
      },
    }));
    for (const next of ['alice', 'ben', 'alice', 'ben', 'alice'] as const) {
      customer = next;
      assert.deepEqual(await payload(client, 'getMyProfile'), expected[next].profile);
      assert.deepEqual(await payload(client, 'getMyOrders'), expected[next].orders);
    }
  } finally { await client.close(); }
});

test('concurrent requests from both customers do not share identity', async () => {
  const alice = await connect('alice');
  const ben = await connect('ben');
  try {
    await Promise.all(Array.from({ length: 10 }, async () => {
      const results = await Promise.all([
        payload(alice, 'getMyProfile'), payload(ben, 'getMyProfile'),
        payload(alice, 'getMyOrders'), payload(ben, 'getMyOrders'),
      ]);
      assert.deepEqual(results, [expected.alice.profile, expected.ben.profile, expected.alice.orders, expected.ben.orders]);
    }));
  } finally { await Promise.all([alice.close(), ben.close()]); }
});

test('basic localhost Host and Origin guards', async () => {
  const auth = ['Authorization', 'Bearer demo-alice-token'];
  for (const origin of ['https://evil.example', 'not-an-origin']) {
    assert.equal((await post([...auth, 'Origin', origin])).status, 403);
  }
  assert.equal((await post(auth, 'evil.example')).status, 403);
  assert.equal((await post([...auth, 'Origin', 'http://localhost:3000'])).status, 200);
});
