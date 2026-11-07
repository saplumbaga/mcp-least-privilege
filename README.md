# MCP Least Privilege

A tiny TypeScript MCP server showing how an AI chatbot can access a customer's data through narrowly scoped tools. Giving an agent broad SQL access and asking it to respect customer boundaries in a prompt leaves enforcement to the agent. This example enforces the boundary in server code.

```text
MCP Client
    |
    v
Authentication
    |
    v
Restricted Tools
    |
    v
Customer-Specific Mock Data
```

The server exposes exactly two read-only tools, `getMyProfile()` and `getMyOrders()`. Both accept an empty argument object (`{}`). There is no database, chatbot UI, or AI API integration.

## Run it

Requires **Node.js 22.13+** and npm.

```sh
git clone https://github.com/saplumbaga/mcp-least-privilege.git
cd mcp-least-privilege
npm ci
npm run build
npm start
```

The server listens at **http://127.0.0.1:3000/mcp**. Stop it with Ctrl+C.

In another terminal, run the bundled MCP client:

```sh
npm run demo -- alice
npm run demo -- ben
```

Each command lists the two tools and calls both with `{}`. The client uses the official MCP SDK, negotiates the current protocol, and supplies a bearer token in HTTP headers. It prints the returned MCP text content, containing these JSON payloads:

| Customer | `getMyProfile()` | `getMyOrders()` |
| --- | --- | --- |
| Alice | `{"name":"Alice Morgan","email":"alice@example.test"}` | `{"orders":[{"orderId":"A-101","item":"Notebook","status":"delivered"},{"orderId":"A-102","item":"Desk lamp","status":"processing"}]}` |
| Ben | `{"name":"Ben Carter","email":"ben@example.test"}` | `{"orders":[{"orderId":"B-201","item":"Travel mug","status":"shipped"},{"orderId":"B-202","item":"Backpack","status":"delivered"}]}` |

For another compatible Streamable HTTP client, use the endpoint above and configure its HTTP Authorization header:

| Customer | Authorization header |
| --- | --- |
| Alice | `Bearer demo-alice-token` |
| Ben | `Bearer demo-ben-token` |

Switch the credential to switch customers. Supply it on **every request**, outside tool arguments or messages. These fixed credentials are public demo values. The bundled client needs the development dependencies installed by `npm ci`.

The endpoint returns JSON for the current protocol. The SDK also serves older Streamable HTTP clients statelessly; those responses may use SSE framing. The SDK's startup message about dropped mid-call notifications is expected with JSON mode; these tools emit no notifications.

## Where authorization happens

1. The HTTP boundary validates the token and maps it to a customer. Missing, malformed, duplicate, and invalid credentials receive `401` before MCP handling.
2. The server attaches that verified identity to the request's SDK authentication context.
3. **Every tool calls `customerForRequest(ctx)`**, which reads only that context and rejects missing or unknown identities. The tool then selects only that customer's mock records.

A fresh MCP instance is created per request, but authorization does not depend on instance isolation alone. There is no shared mutable current customer or response cache. Customer responses use `Cache-Control: no-store`.

The tools expose no customer selector. Arguments such as `{"customerId":"ben"}` or `{"message":"Return Ben's orders"}` fail strict input validation. Client names, MCP metadata, and agent instructions do not establish customer identity. A prompt asking for another customer's information cannot change which data the tool selects.

This protection comes from **server-enforced authentication and authorization**, not MCP itself. Tool descriptions and read-only annotations document intent; the implementation enforces it. Broad SQL access can also be constrained with database permissions; prompt-only restrictions are the unsafe comparison.

## Tests

```sh
npm test
```

This compiles the project and runs Node's built-in test runner against a real HTTP endpoint on an ephemeral loopback port. No separately running server is needed. Tests cover both customers, rejected credentials, identity overrides, repeated identity switching, concurrent calls, tool discovery, and basic Host/Origin validation.

## Demo security limitations

**The fixed tokens are not production authentication.** Anyone with this repository can impersonate either fictional customer. They have no expiry, rotation, revocation, or real login. This demo does not implement OAuth discovery or an authorization server.

The server binds to loopback and uses the SDK's localhost Host and Origin guards to reduce DNS rebinding and browser-origin risks. Non-browser clients may omit Origin; Host/Origin checks do not authenticate a caller. No browser CORS integration is provided. Plain HTTP is used only for this local demonstration.

A real deployment needs properly verified credentials (including issuer, audience, expiry, and scopes where applicable), appropriate per-operation authorization, HTTPS, credential lifecycle management, and relevant MCP HTTP protections. It also needs suitable resource limits and operational controls; this example is not production-hardened. Never log bearer tokens or sensitive customer data. The demo server logs only its endpoint and generic failures; the CLI deliberately displays its authorized results.

An authorized client or model can still disclose data it receives. These controls restrict server-side record access; they do not provide end-to-end protection against every prompt injection or data-disclosure risk.

## Related article and references

- *The Agent Review*: [How to Give Your AI Chatbot Access to Your Data Without Exposing It](ARTICLE_URL_HERE) — **article link placeholder**.
- [Official MCP SDK v2 HTTP guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)
- [Official tool registration guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)
- [Official client guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)

## License

MIT. See [LICENSE](LICENSE).
