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
export const mkdirSync = (path: string): void => {
	call("fs.mkdir", { path });
};
export const unlinkSync = (path: string): void => {
	call("fs.unlink", { path });
};
export const openSync = (path: string, _flags: string): number => {
	call("fs.open", { path, flags: _flags });
	return 0;
};
export const accessSync = (path: string): boolean => call("fs.access", { path }) as boolean;
export const realpathSync = (path: string): string => call("fs.realpath", { path }) as string;
export const renameSync = (from: string, to: string): void => {
	call("fs.rename", { from, to });
};
export const copyFileSync = (from: string, to: string): void => {
	call("fs.copyFile", { from, to });
};
export const appendFileSync = (path: string, content: string): void => {
	call("fs.appendFile", { path, content });
};
export const closeSync = (_descriptor: number): void => undefined;
export const chmodSync = (path: string, mode: number): void => {
	call("fs.chmod", { path, mode });
};
export const watch = (_path: string, _listener: (...args: unknown[]) => void): (() => void) => () => undefined;

/// A readable stream over a file. The embedded host has no streams, so the
/// object carries the content and the helpers that read it.
export const createReadStream = (path: string) => {
	const content = readFileSync(path);
	let position = 0;
	return {
		read: () => {
			if (position >= content.length) return null;
			const chunk = content.slice(position);
			position = content.length;
			return chunk;
		},
		on: () => undefined,
		close: () => undefined,
	};
};
export const globSync = (_pattern: string): string[] => {
	throw new Error("fs.globSync is not available in the embedded extension host");
};
export const createWriteStream = (path: string) => {
	let content = "";
	return {
		write: (chunk: string) => {
			content += chunk;
			return true;
		},
		end: () => {
			writeFileSync(path, content);
		},
		on: () => undefined,
	};
};
export const mkdtempSync = (prefix: string): string =>
	call("fs.mkdtemp", { prefix }) as string;
export const unwatchFile = (_path: string): void => undefined;
export const watchFile = (_path: string, _listener: (...args: unknown[]) => void): (() => void) => () => undefined;
export const lstatSync = (path: string) => statSync(path);
export const fstatSync = (descriptor: number) => statSync(String(descriptor));
export const readlinkSync = (path: string): string => path;
export const symlinkSync = (_target: string, _path: string): void => undefined;
export const rmdirSync = (path: string): void => {
	call("fs.rmdir", { path });
};
export const truncateSync = (path: string, length: number): void => {
	call("fs.truncate", { path, length });
};
export const chownSync = (_path: string, _uid: number, _gid: number): void => undefined;
export const utimesSync = (_path: string, _atime: number, _mtime: number): void => undefined;
export const writeSync = (_descriptor: number, content: string): number => content.length;
export const readSync = (descriptor: number, _buffer: unknown, _offset?: number, _length?: number, _position?: number): number => {
	void descriptor;
	return 0;
};
export const rmSync = (path: string, options?: { recursive?: boolean; force?: boolean }): void => {
	if (options?.force && !existsSync(path)) return;
	unlinkSync(path);
};
export const constants = {
	F_OK: 0,
	R_OK: 4,
	W_OK: 2,
	X_OK: 1,
	O_RDONLY: 0,
	O_WRONLY: 1,
	O_RDWR: 2,
	O_CREAT: 64,
	O_TRUNC: 512,
	O_APPEND: 1024,
};

export const readFile = async (path: string): Promise<string> => readFileSync(path);
export const writeFile = async (path: string, content: string): Promise<void> => {
	writeFileSync(path, content);
};
export const exists = async (path: string): Promise<boolean> => existsSync(path);
export const readdir = async (path: string): Promise<string[]> => readdirSync(path);
export const stat = async (path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number }> =>
	statSync(path);
export const mkdir = async (path: string): Promise<void> => {
	mkdirSync(path);
};
export const unlink = async (path: string): Promise<void> => {
	unlinkSync(path);
};
export const access = async (path: string): Promise<boolean> => accessSync(path);
export const realpath = async (path: string): Promise<string> => realpathSync(path);
export const rename = async (from: string, to: string): Promise<void> => {
	renameSync(from, to);
};
export const copyFile = async (from: string, to: string): Promise<void> => {
	copyFileSync(from, to);
};
export const appendFile = async (path: string, content: string): Promise<void> => {
	appendFileSync(path, content);
};
export const open = async (
	path: string,
	flags: string,
): Promise<{ read: () => Promise<string>; close: () => Promise<void> }> => {
	openSync(path, flags);
	return {
		read: async () => readFileSync(path),
		close: async () => undefined,
	};
};

export const mkdtemp = async (prefix: string): Promise<string> => mkdtempSync(prefix);

export const promises = {
	readFile,
	writeFile,
	exists,
	readdir,
	stat,
	mkdir,
	unlink,
	open,
	access,
	realpath,
	rename,
	copyFile,
	appendFile,
	mkdtemp,
};

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
	mkdir,
	mkdirSync,
	unlink,
	unlinkSync,
	open,
	openSync,
	access,
	accessSync,
	realpath,
	realpathSync,
	unlink,
	unlinkSync,
	rename,
	renameSync,
	copyFile,
	copyFileSync,
	appendFile,
	appendFileSync,
	constants,
	closeSync,
	chmodSync,
	watch,
	createReadStream,
	createWriteStream,
	globSync,
	readSync,
	mkdtempSync,
	unwatchFile,
	watchFile,
	lstatSync,
	fstatSync,
	readlinkSync,
	symlinkSync,
	rmdirSync,
	truncateSync,
	chownSync,
	utimesSync,
	writeSync,
	rmSync,
	promises,
};
