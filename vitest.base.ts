import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	chordIndex: fileURLToPath(new URL("./packages/chord/src/index.ts", import.meta.url)),
	chordContext: fileURLToPath(new URL("./packages/chord/src/context/index.ts", import.meta.url)),
	chordDelta: fileURLToPath(new URL("./packages/chord/src/delta/index.ts", import.meta.url)),
	chordNode: fileURLToPath(new URL("./packages/chord/src/node.ts", import.meta.url)),
	mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
	mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
	mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiApi: fileURLToPath(new URL("./packages/ai/src/api", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	aiUtils: fileURLToPath(new URL("./packages/ai/src/utils", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
	codemodeDeclarations: fileURLToPath(new URL("./packages/codemode/src/declarations.ts", import.meta.url)),
	codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	codingAgentSrc: fileURLToPath(new URL("./packages/coding-agent/src", import.meta.url)),
	serverIndex: fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
	serverClient: fileURLToPath(new URL("./packages/server/src/client.ts", import.meta.url)),
	supportSrc: fileURLToPath(new URL("./packages/support/src", import.meta.url)),
	tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
	tuiColors: fileURLToPath(new URL("./packages/tui/src/colors.ts", import.meta.url)),
	tuiTerminalCapabilities: fileURLToPath(new URL("./packages/tui/src/terminal-capabilities.ts", import.meta.url)),
	tuiSrc: fileURLToPath(new URL("./packages/tui/src", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@earendil-works\/chord$/, replacement: workspaceSourcePaths.chordIndex },
			{ find: /^@earendil-works\/chord\/context$/, replacement: workspaceSourcePaths.chordContext },
			{ find: /^@earendil-works\/chord\/delta$/, replacement: workspaceSourcePaths.chordDelta },
			{ find: /^@earendil-works\/chord\/node$/, replacement: workspaceSourcePaths.chordNode },
			{ find: /^@earendil-works\/pi-mcp$/, replacement: workspaceSourcePaths.mcpIndex },
			{ find: /^@earendil-works\/pi-mcp\/oauth$/, replacement: workspaceSourcePaths.mcpOAuth },
			{ find: /^@earendil-works\/pi-mcp\/testing$/, replacement: workspaceSourcePaths.mcpTesting },
			{ find: /^@earendil-works\/pi-ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@earendil-works\/pi-ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@earendil-works\/pi-ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@earendil-works\/pi-ai\/utils\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
			},
			{
				find: /^@earendil-works\/pi-ai\/api\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
			},
			{
				find: /^@earendil-works\/pi-ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@earendil-works\/pi-codemode$/, replacement: workspaceSourcePaths.codemodeIndex },
			{ find: /^@earendil-works\/pi-codemode\/declarations$/, replacement: workspaceSourcePaths.codemodeDeclarations },
			{ find: /^@earendil-works\/pi-codemode\/source$/, replacement: workspaceSourcePaths.codemodeSource },
			{ find: /^@earendil-works\/pi-coding-agent$/, replacement: workspaceSourcePaths.codingAgentIndex },
			{
				find: /^@earendil-works\/pi-coding-agent\/(.+)$/,
				replacement: `${workspaceSourcePaths.codingAgentSrc}/$1.ts`,
			},
			{ find: /^@earendil-works\/pi-server$/, replacement: workspaceSourcePaths.serverIndex },
			{ find: /^@earendil-works\/pi-server\/client$/, replacement: workspaceSourcePaths.serverClient },
			{ find: /^@earendil-works\/pi-support\/(.+)$/, replacement: `${workspaceSourcePaths.supportSrc}/$1.ts` },
			{ find: /^@earendil-works\/pi-tui$/, replacement: workspaceSourcePaths.tuiIndex },
			{ find: /^@earendil-works\/pi-tui\/colors$/, replacement: workspaceSourcePaths.tuiColors },
			{
				find: /^@earendil-works\/pi-tui\/terminal-capabilities$/,
				replacement: workspaceSourcePaths.tuiTerminalCapabilities,
			},
			// The narrow entries of the terminal interface, so a module that needs a
			// component does not pull the whole barrel with it.
			{ find: /^@earendil-works\/pi-tui\/(components\/[\w-]+|[\w-]+)$/, replacement: `${workspaceSourcePaths.tuiSrc}/$1.ts` },
		],
	},
});
