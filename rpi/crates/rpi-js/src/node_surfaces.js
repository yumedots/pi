(() => {
	const call = (op, args) => {
		const response = JSON.parse(globalThis.__piHostCall(op, JSON.stringify(args ?? {})));
		if (!response.ok) throw new Error(response.error);
		return response.value;
	};

	const format = (value) => {
		if (typeof value === "string") return value;
		if (value instanceof Error) return value.stack ?? value.message;
		try {
			return JSON.stringify(value) ?? String(value);
		} catch {
			return String(value);
		}
	};

	const path = {
		sep: "/",
		join: (...parts) => {
			const joined = parts.filter((part) => part !== undefined && part !== null && part !== "").join("/");
			return path.normalize(joined);
		},
		normalize: (value) => {
			const absolute = value.startsWith("/");
			const out = [];
			for (const part of value.split("/")) {
				if (part === "" || part === ".") continue;
				if (part === "..") {
					if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
					else if (!absolute) out.push("..");
					continue;
				}
				out.push(part);
			}
			const joined = out.join("/");
			return absolute ? `/${joined}` : joined === "" ? "." : joined;
		},
		resolve: (...parts) => {
			let resolved = parts.filter((part) => part !== undefined && part !== null && part !== "").join("/");
			if (!resolved.startsWith("/")) resolved = `${call("process.cwd", {})}/${resolved}`;
			return path.normalize(resolved);
		},
		dirname: (value) => {
			const normalized = path.normalize(value);
			const index = normalized.lastIndexOf("/");
			if (index < 0) return ".";
			if (index === 0) return "/";
			return normalized.slice(0, index);
		},
		basename: (value, extension) => {
			const normalized = path.normalize(value);
			let base = normalized.slice(normalized.lastIndexOf("/") + 1);
			if (extension && base.endsWith(extension)) base = base.slice(0, -extension.length);
			return base;
		},
		extname: (value) => {
			const base = path.basename(value);
			const index = base.lastIndexOf(".");
			return index <= 0 ? "" : base.slice(index);
		},
		relative: (from, to) => {
			const fromParts = path.normalize(from).split("/").filter(Boolean);
			const toParts = path.normalize(to).split("/").filter(Boolean);
			let common = 0;
			while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
			const up = fromParts.length - common;
			return [...Array(up).fill(".."), ...toParts.slice(common)].join("/");
		},
		isAbsolute: (value) => value.startsWith("/"),
	};

	const fs = {
		readFileSync: (file, encoding) => call("fs.readFile", { path: String(file), encoding: encoding ?? "utf8" }),
		writeFileSync: (file, data) => call("fs.writeFile", { path: String(file), content: String(data) }),
		existsSync: (file) => call("fs.exists", { path: String(file) }),
		readdirSync: (file) => call("fs.readdir", { path: String(file) }),
		statSync: (file) => call("fs.stat", { path: String(file) }),
		mkdirSync: (file) => call("fs.mkdir", { path: String(file) }),
	};

	const fsPromises = {
		readFile: async (file) => fs.readFileSync(file),
		writeFile: async (file, data) => fs.writeFileSync(file, data),
		exists: async (file) => fs.existsSync(file),
		readdir: async (file) => fs.readdirSync(file),
		stat: async (file) => fs.statSync(file),
	};

	globalThis.__piNodeModules = {
		"node:fs": fs,
		"node:fs/promises": fsPromises,
		"node:path": path,
		fs,
		"fs/promises": fsPromises,
		path,
	};

	globalThis.process = {
		env: call("process.env", {}),
		argv: call("process.argv", {}),
		platform: call("process.platform", {}),
		pid: call("process.pid", {}),
		version: "v22.19.0",
		cwd: () => call("process.cwd", {}),
		exit: (code) => {
			throw new Error(`process.exit(${code}) is not available in the embedded host`);
		},
	};

	globalThis.performance = {
		now: () => call("performance.now", {}),
	};

	globalThis.TextEncoder = class TextEncoder {
		encode(input = "") {
			const bytes = call("text.encode", { text: String(input) });
			return new Uint8Array(bytes);
		}
		encodeInto(source, destination) {
			const encoded = this.encode(source);
			const written = Math.min(encoded.length, destination.length);
			destination.set(encoded.subarray(0, written));
			return { read: source.length, written };
		}
	};

	globalThis.TextDecoder = class TextDecoder {
		decode(input) {
			if (!input) return "";
			return call("text.decode", { bytes: Array.from(input) });
		}
	};

	const log = (level) => (...values) => {
		call(`console.${level}`, { level, message: values.map(format).join(" ") });
	};

	globalThis.console = {
		log: log("log"),
		info: log("info"),
		warn: log("warn"),
		error: log("error"),
		debug: log("debug"),
	};

	globalThis.__piCall = async (encodedName, encodedArguments) => {
		try {
			const name = JSON.parse(encodedName);
			const target = name.split(".").reduce((value, part) => value?.[part], globalThis);
			if (typeof target !== "function") throw new Error(`${name} is not a function`);
			const args = JSON.parse(encodedArguments);
			const value = await target(...args);
			return JSON.stringify({ ok: true, value: value === undefined ? null : value });
		} catch (error) {
			const message = error instanceof Error ? String(error.stack ?? error.message) : String(error);
			return JSON.stringify({ ok: false, error: message });
		}
	};

	globalThis.__piEval = (source) => (0, eval)(source);
})();
