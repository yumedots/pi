const modules = (
	globalThis as unknown as { __piNodeModules: Record<string, Record<string, unknown>> }
).__piNodeModules;

const path = modules["node:path"] as {
	sep: string;
	delimiter: string;
	join: (...parts: string[]) => string;
	normalize: (value: string) => string;
	resolve: (...parts: string[]) => string;
	dirname: (value: string) => string;
	basename: (value: string, extension?: string) => string;
	extname: (value: string) => string;
	relative: (from: string, to: string) => string;
	isAbsolute: (value: string) => boolean;
	parse: (value: string) => { root: string; dir: string; base: string; ext: string; name: string };
	format: (parts: { root?: string; dir?: string; base?: string; ext?: string; name?: string }) => string;
};

export const sep = path.sep;
export const delimiter = path.delimiter;
export const join = path.join;
export const normalize = path.normalize;
export const resolve = path.resolve;
export const dirname = path.dirname;
export const basename = path.basename;
export const extname = path.extname;
export const relative = path.relative;
export const isAbsolute = path.isAbsolute;
export const parse = path.parse;
export const format = path.format;

/// The Windows and POSIX variants of the path helpers.
///
/// The embedded host runs on the platform it was built for, so the variant
/// that matches the host's separator is the live one; the other is the same
/// set of helpers, so a caller that asks for `win32` still gets a path.
const variant = {
	sep: path.sep,
	delimiter: path.delimiter,
	join: path.join,
	normalize: path.normalize,
	resolve: path.resolve,
	dirname: path.dirname,
	basename: path.basename,
	extname: path.extname,
	relative: path.relative,
	isAbsolute: path.isAbsolute,
	parse: path.parse,
	format: path.format,
};

export const win32 = variant;
export const posix = variant;

export default { ...path, win32, posix };
