import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMcpHandler, McpServer, type AuthInfo, type ServerContext } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { customers, demoTokens } from './data.js';

function authenticate(req: IncomingMessage): AuthInfo | undefined {
  // Node can discard duplicate Authorization headers; inspect the raw headers too.
  const count = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'authorization').length;
  if (count !== 1) return;
  const match = /^Bearer ([^\s,]+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return;
  const token = match[1];
  const customerId = token === demoTokens.alice ? 'alice' : token === demoTokens.ben ? 'ben' : undefined;
  if (!customerId) return;
  return { token, clientId: 'local-demo-client', scopes: [], extra: { customerId } };
}

// The authorization boundary: every tool selects data using validated HTTP context.
// Never read customer identity from tool arguments, messages, or MCP metadata.
function customerForRequest(ctx: ServerContext) {
  const id = ctx.http?.authInfo?.extra?.customerId;
  if (id !== 'alice' && id !== 'ben') throw new Error('Authenticated customer required');
  return customers[id];
}

export function createDemoServer() {
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'mcp-least-privilege', version: '1.0.0' });
    mcp.registerTool('getMyProfile', {
      description: 'Return only the authenticated customer’s profile.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    }, async (_args, ctx) => {
      const customer = customerForRequest(ctx);
      return { content: [{ type: 'text', text: JSON.stringify(customer.profile) }] };
    });
    mcp.registerTool('getMyOrders', {
      description: 'Return only the authenticated customer’s orders.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    }, async (_args, ctx) => {
      const customer = customerForRequest(ctx);
      return { content: [{ type: 'text', text: JSON.stringify({ orders: customer.orders }) }] };
    });
    return mcp;
  }, { responseMode: 'json' });
  const handleMcp = toNodeHandler({
    async fetch(request, options) {
      const response = await handler.fetch(request, options);
      // Set this after the SDK has supplied its transport response headers.
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
  });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const server = createServer((req: IncomingMessage & { auth?: AuthInfo }, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    const auth = authenticate(req);
    if (!auth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="local-demo"', 'Content-Type': 'text/plain' });
      res.end('Valid demo bearer token required');
      return;
    }
    req.auth = auth;
    void handleMcp(req, res).catch(() => {
      // Do not log errors containing request context or customer results.
      if (!res.headersSent) res.writeHead(500).end('Request failed');
      else res.destroy();
    });
  });
  return {
    server,
    async close() {
      const closed = new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      await handler.close();
      await closed;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createDemoServer();
  app.server.on('error', () => {
    console.error('Unable to start demo server');
    process.exitCode = 1;
  });
  app.server.listen(3000, '127.0.0.1', () => {
    console.log('Demo MCP server: http://127.0.0.1:3000/mcp');
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        console.error('Unable to close demo server');
        process.exitCode = 1;
      });
    });
  }
}
