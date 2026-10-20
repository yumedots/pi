const modules = (
	globalThis as unknown as { __piNodeModules: Record<string, Record<string, unknown>> }
).__piNodeModules;

const path = modules["node:path"] as {
	sep: string;
	join: (...parts: string[]) => string;
	normalize: (value: string) => string;
	resolve: (...parts: string[]) => string;
	dirname: (value: string) => string;
	basename: (value: string, extension?: string) => string;
	extname: (value: string) => string;
	relative: (from: string, to: string) => string;
	isAbsolute: (value: string) => boolean;
};

export const sep = path.sep;
export const join = path.join;
export const normalize = path.normalize;
export const resolve = path.resolve;
export const dirname = path.dirname;
export const basename = path.basename;
export const extname = path.extname;
export const relative = path.relative;
export const isAbsolute = path.isAbsolute;
export default path;
