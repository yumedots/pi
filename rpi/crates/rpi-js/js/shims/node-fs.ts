/// Ask the host to do something.
///
/// The arguments cross the boundary as JSON, and the answer comes back the
/// same way: a call that does not encode its arguments is silently ignored
/// by the host, which reads as a write that reports success and writes
/// nothing.
const call = (op: string, args: Record<string, unknown>): unknown => {
	const bridge = (
		globalThis as unknown as {
			__piHostCall: (op: string, args: string) => string;
		}
	).__piHostCall;
	const response = JSON.parse(bridge(op, JSON.stringify(args ?? {}))) as {
		ok: boolean;
		value?: unknown;
		error?: string;
	};
	if (!response.ok) {
		throw new Error(response.error ?? "the host refused the call");
	}
	return response.value;
};

const readFileSync = (path: string): string => call("fs.readFile", { path }) as string;
const writeFileSync = (path: string, content: string): void => {
	call("fs.writeFile", { path, content });
};
const existsSync = (path: string): boolean => call("fs.exists", { path }) as boolean;
const readdirSync = (path: string): string[] => call("fs.readdir", { path }) as string[];
const statSync = (path: string): { isDirectory: boolean; isFile: boolean; size: number } =>
	call("fs.stat", { path }) as { isDirectory: boolean; isFile: boolean; size: number };
const mkdirSync = (path: string): void => {
	call("fs.mkdir", { path });
};
const unlinkSync = (path: string): void => {
	call("fs.unlink", { path });
};
const openSync = (path: string, _flags: string): number => {
	call("fs.open", { path, flags: _flags });
	return 0;
};
const accessSync = (path: string): boolean => call("fs.access", { path }) as boolean;
const realpathSync = (path: string): string => call("fs.realpath", { path }) as string;
const renameSync = (from: string, to: string): void => {
	call("fs.rename", { from, to });
};
const copyFileSync = (from: string, to: string): void => {
	call("fs.copyFile", { from, to });
};
const appendFileSync = (path: string, content: string): void => {
	call("fs.appendFile", { path, content });
};
const closeSync = (_descriptor: number): void => undefined;
const chmodSync = (path: string, mode: number): void => {
	call("fs.chmod", { path, mode });
};
const watch = (_path: string, _listener: (...args: unknown[]) => void): (() => void) => () => undefined;

/// A readable stream over a file. The embedded host has no streams, so the
/// object carries the content and the helpers that read it.
const createReadStream = (path: string) => {
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
const globSync = (_pattern: string): string[] => {
	throw new Error("fs.globSync is not available in the embedded extension host");
};
const createWriteStream = (path: string) => {
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
const mkdtempSync = (prefix: string): string =>
	call("fs.mkdtemp", { prefix }) as string;
const unwatchFile = (_path: string): void => undefined;
const watchFile = (_path: string, _listener: (...args: unknown[]) => void): (() => void) => () => undefined;
const lstatSync = (path: string) => statSync(path);
const fstatSync = (descriptor: number) => statSync(String(descriptor));
const readlinkSync = (path: string): string => path;
const symlinkSync = (_target: string, _path: string): void => undefined;
const rmdirSync = (path: string): void => {
	call("fs.rmdir", { path });
};
const truncateSync = (path: string, length: number): void => {
	call("fs.truncate", { path, length });
};
const chownSync = (_path: string, _uid: number, _gid: number): void => undefined;
const utimesSync = (_path: string, _atime: number, _mtime: number): void => undefined;
const writeSync = (_descriptor: number, content: string): number => content.length;
const readSync = (descriptor: number, _buffer: unknown, _offset?: number, _length?: number, _position?: number): number => {
	void descriptor;
	return 0;
};
const rmSync = (path: string, options?: { recursive?: boolean; force?: boolean }): void => {
	if (options?.force && !existsSync(path)) return;
	unlinkSync(path);
};
const constants = {
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

const readFile = async (path: string): Promise<string> => readFileSync(path);
const writeFile = async (path: string, content: string): Promise<void> => {
	writeFileSync(path, content);
};
const exists = async (path: string): Promise<boolean> => existsSync(path);
const readdir = async (path: string): Promise<string[]> => readdirSync(path);
const stat = async (path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number }> =>
	statSync(path);
const mkdir = async (path: string): Promise<void> => {
	mkdirSync(path);
};
const unlink = async (path: string): Promise<void> => {
	unlinkSync(path);
};
const access = async (path: string): Promise<boolean> => accessSync(path);
const realpath = async (path: string): Promise<string> => realpathSync(path);
const rename = async (from: string, to: string): Promise<void> => {
	renameSync(from, to);
};
const copyFile = async (from: string, to: string): Promise<void> => {
	copyFileSync(from, to);
};
const appendFile = async (path: string, content: string): Promise<void> => {
	appendFileSync(path, content);
};
const open = async (
	path: string,
	flags: string,
): Promise<{ read: () => Promise<string>; close: () => Promise<void> }> => {
	openSync(path, flags);
	return {
		read: async () => readFileSync(path),
		close: async () => undefined,
	};
};

const mkdtemp = async (prefix: string): Promise<string> => mkdtempSync(prefix);

const promises = {
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

/// The module object.
///
/// It is a plain object on purpose: a CommonJS package in pi's dependency
/// tree (`graceful-fs`) patches `fs.closeSync` and the rest, and an ESM
/// namespace has getter-only properties, so the assignment would throw.
const fs = {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
	mkdirSync,
	unlinkSync,
	openSync,
	accessSync,
	realpathSync,
	renameSync,
	copyFileSync,
	appendFileSync,
	closeSync,
	chmodSync,
	watch,
	createReadStream,
	globSync,
	createWriteStream,
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
	readSync,
	rmSync,
	constants,
	readFile,
	writeFile,
	exists,
	readdir,
	stat,
	mkdir,
	unlink,
	access,
	realpath,
	rename,
	copyFile,
	appendFile,
	open,
	mkdtemp,
	promises,
};

export = fs;
