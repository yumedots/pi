/**
 * The port's `/mcp` command.
 *
 * The original ships an MCP extension and its command appears in the session's
 * command list. The port has MCP support end to end — `pi.registerMcpServer`,
 * `pi.getMcpServers` and the dialog bridge — so it publishes a command under
 * pi's name that does the port's real MCP work: it lists the servers the
 * session has and can remove one.
 *
 * The original's own extension cannot be reused: it needs the `pi-mcp`
 * package and the codemode tool, which the port does not ship.
 */

interface McpServer {
	name: string;
	config: unknown;
	extensionPath: string;
}

export default function (pi: {
	registerCommand: (name: string, options: unknown) => void;
	getMcpServers: () => McpServer[];
	unregisterMcpServer: (name: string) => void;
	notify: (message: string, type?: string) => void;
}) {
	pi.registerCommand("mcp", {
		description: "Manage the MCP servers of this session",
		handler: async (args: string) => {
			const servers = pi.getMcpServers();
			const name = (args ?? "").trim();
			if (name) {
				const server = servers.find((entry) => entry.name === name);
				if (!server) {
					pi.notify(`No MCP server named "${name}"`, "error");
					return;
				}
				pi.unregisterMcpServer(name);
				pi.notify(`Removed the MCP server "${name}"`);
				return;
			}
			if (servers.length === 0) {
				pi.notify("No MCP servers are registered");
				return;
			}
			for (const server of servers) {
				pi.notify(`${server.name}: ${describe(server.config)}`);
			}
		},
	});
}

/// A one-line description of a server's configuration.
function describe(config: unknown): string {
	if (config && typeof config === "object") {
		const record = config as Record<string, unknown>;
		if (typeof record.url === "string") return record.url;
		if (typeof record.command === "string") {
			const args = Array.isArray(record.args) ? record.args.join(" ") : "";
			return `${record.command} ${args}`.trim();
		}
	}
	return "configured";
}
