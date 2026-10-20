const call = (op: string, args: Record<string, unknown>): unknown =>
	(globalThis as unknown as { __piHostCall: (op: string, args: unknown) => unknown }).__piHostCall(op, args);

export const readFileSync = (path: string): string => call("fs.readFile", { path }) as string;
export const writeFileSync = (path: string, content: string): void => {
	call("fs.writeFile", { path, content });
};
export const existsSync = (path: string): boolean => call("fs.exists", { path }) as boolean;
export const readdirSync = (path: string): string[] => call("fs.readdir", { path }) as string[];
export const statSync = (path: string): { isDirectory: boolean; isFile: boolean; size: number } =>
	call("fs.stat", { path }) as { isDirectory: boolean; isFile: boolean; size: number };

export const readFile = async (path: string): Promise<string> => readFileSync(path);
export const writeFile = async (path: string, content: string): Promise<void> => {
	writeFileSync(path, content);
};
export const exists = async (path: string): Promise<boolean> => existsSync(path);
export const readdir = async (path: string): Promise<string[]> => readdirSync(path);
export const stat = async (path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number }> =>
	statSync(path);

export const promises = { readFile, writeFile, exists, readdir, stat };

export default {
	readFile,
	readFileSync,
	writeFile,
	writeFileSync,
	exists,
	existsSync,
	readdir,
	readdirSync,
	stat,
	statSync,
	promises,
};
