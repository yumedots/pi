/** Loads the llama interface only when the command runs (see index.ts). */
export const loadLlamaUi = () => import("./ui.ts");
