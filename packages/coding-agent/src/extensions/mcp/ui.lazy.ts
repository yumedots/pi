/** Loads the MCP interface only when the command runs (see index.ts). */
export const loadMcpUi = () => import("./ui.ts");
