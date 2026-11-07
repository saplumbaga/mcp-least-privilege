import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { demoTokens } from './data.js';

const customer = process.argv[2];
if (customer !== 'alice' && customer !== 'ben') {
  console.error('Usage: npm run demo -- alice|ben');
  process.exitCode = 1;
} else {
  const client = new Client({ name: 'customer-demo', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${demoTokens[customer]}` }, redirect: 'error' },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    console.log('Tools:', tools.map(tool => tool.name).join(', '));
    for (const name of ['getMyProfile', 'getMyOrders']) {
      const result = await client.callTool({ name, arguments: {} });
      if (result.isError) throw new Error('Tool failed');
      console.log(name, result.content);
    }
  } catch {
    console.error('Demo failed. Build the project and start the server first.');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
