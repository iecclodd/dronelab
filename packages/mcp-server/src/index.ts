import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Connect an official-SDK client to an already paired, remote DroneLab relay. */
export async function connectDroneLabRelay(options: { endpoint: string; relaySecret: string; sessionId: string; mcpToken: string; clientName?: string }): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const url = new URL(options.endpoint);
  url.searchParams.set("sessionId", options.sessionId);
  const client = new Client({ name: options.clientName ?? "dronelab-mcp-client", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${options.relaySecret}`, "X-DroneLab-Pair-Token": options.mcpToken } } });
  await client.connect(transport);
  return { client, transport };
}
