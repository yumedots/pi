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
		delimiter: ":",
		parse: (value) => {
			const normalized = path.normalize(value);
			const base = path.basename(normalized);
			const index = base.lastIndexOf(".");
			return {
				root: normalized.startsWith("/") ? "/" : "",
				dir: path.dirname(normalized),
				base,
				ext: index <= 0 ? "" : base.slice(index),
				name: index <= 0 ? base : base.slice(0, index),
			};
		},
		format: (parts) => {
			const dir = parts.dir ? path.join(parts.dir, parts.name ?? parts.base ?? "") : (parts.base ?? "");
			return dir;
		},
	};

	const fs = {
		readFileSync: (file, encoding) => call("fs.readFile", { path: String(file), encoding: encoding ?? "utf8" }),
		writeFileSync: (file, data) => call("fs.writeFile", { path: String(file), content: String(data) }),
		existsSync: (file) => call("fs.exists", { path: String(file) }),
		readdirSync: (file) => call("fs.readdir", { path: String(file) }),
		statSync: (file) => call("fs.stat", { path: String(file) }),
		mkdirSync: (file) => call("fs.mkdir", { path: String(file) }),
		unlinkSync: (file) => call("fs.unlink", { path: String(file) }),
		renameSync: (from, to) => call("fs.rename", { from: String(from), to: String(to) }),
		copyFileSync: (from, to) => call("fs.copyFile", { from: String(from), to: String(to) }),
		appendFileSync: (file, data) => call("fs.appendFile", { path: String(file), content: String(data) }),
		accessSync: (file) => call("fs.access", { path: String(file) }),
		realpathSync: (file) => call("fs.realpath", { path: String(file) }),
		constants: {
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
		},
	};

	const fsPromises = {
		readFile: async (file) => fs.readFileSync(file),
		mkdir: async (file) => fs.mkdirSync(file),
		unlink: async (file) => fs.unlinkSync(file),
		rename: async (from, to) => fs.renameSync(from, to),
		copyFile: async (from, to) => fs.copyFileSync(from, to),
		appendFile: async (file, data) => fs.appendFileSync(file, data),
		access: async (file) => fs.accessSync(file),
		realpath: async (file) => fs.realpathSync(file),
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

	// CommonJS packages reach for `global`; in the browser platform it is
	// the global object itself.
	globalThis.global = globalThis;


	globalThis.process = {
		// The environment is read when it is used, not copied when the
		// surface runs: a copy that arrives empty (or null) takes down every
		// bundled module that reads `process.env`.
		get env() {
			return call("process.env", {}) ?? {};
		},
		argv: call("process.argv", {}),
		platform: call("process.platform", {}),
		pid: call("process.pid", {}),
		version: "v22.19.0",
		cwd: () => call("process.cwd", {}),
		exit: (code) => {
			throw new Error(`process.exit(${code}) is not available in the embedded host`);
		},
	};

	// The bundle replaces the global `process` when it loads (a CommonJS
	// package in pi's dependency tree installs its own). The runtime restores
	// the host's object after the bundle has run.
	globalThis.__piProcess = globalThis.process;

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

	// ---- base64 -----------------------------------------------------------
	//
	// `atob` and `btoa` are Node globals. An extension that decodes a base64
	// secret while it loads needs them, and the embedded host has no `Buffer`
	// to lean on, so the two are implemented here.
	const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

	globalThis.atob = (data) => {
		const text = String(data).replace(/[\t\n\f\r ]/g, "");
		let length = text.length;
		while (length > 0 && text[length - 1] === "=") length--;
		if (length % 4 === 1) throw new Error("Invalid character");
		const bytes = [];
		let buffer = 0;
		let bits = 0;
		for (let index = 0; index < length; index++) {
			const character = text[index];
			const value = BASE64_ALPHABET.indexOf(character);
			if (value < 0) throw new Error(`Invalid character: ${character}`);
			buffer = (buffer << 6) | value;
			bits += 6;
			if (bits >= 8) {
				bits -= 8;
				bytes.push((buffer >> bits) & 0xff);
			}
		}
		let out = "";
		for (const byte of bytes) out += String.fromCharCode(byte);
		return out;
	};

	globalThis.btoa = (data) => {
		const text = String(data);
		let out = "";
		for (let index = 0; index < text.length; index += 3) {
			const first = text.charCodeAt(index);
			const second = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
			const third = index + 2 < text.length ? text.charCodeAt(index + 2) : Number.NaN;
			if (first > 0xff || second > 0xff || third > 0xff) {
				throw new Error("Invalid character");
			}
			const triple =
				(first << 16) | ((Number.isNaN(second) ? 0 : second) << 8) | (Number.isNaN(third) ? 0 : third);
			out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
			out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
			out += Number.isNaN(second) ? "=" : BASE64_ALPHABET[(triple >> 6) & 0x3f];
			out += Number.isNaN(third) ? "=" : BASE64_ALPHABET[triple & 0x3f];
		}
		return out;
	};

	// ---- timers -----------------------------------------------------------
	//
	// The embedded host has no event loop: a timer is a deadline on a virtual
	// clock that only moves when the runtime pumps the queue. The pump runs
	// while the runtime waits for a promise to settle, so an extension that
	// awaits a timer makes progress instead of hanging.
	let timerNow = 0;
	let timerId = 0;
	const timers = new Map();

	globalThis.setTimeout = (callback, delay = 0, ...args) => {
		const id = ++timerId;
		timers.set(id, {
			at: timerNow + Math.max(0, Number(delay) || 0),
			callback,
			args,
			period: null,
		});
		return id;
	};
	globalThis.setInterval = (callback, delay = 0, ...args) => {
		const id = ++timerId;
		const period = Math.max(1, Number(delay) || 1);
		timers.set(id, { at: timerNow + period, callback, args, period });
		return id;
	};
	globalThis.clearTimeout = (id) => {
		timers.delete(id);
	};
	globalThis.clearInterval = (id) => {
		timers.delete(id);
	};
	globalThis.queueMicrotask = (callback) => {
		Promise.resolve().then(() => callback());
	};

	/// Run every timer whose deadline has come, oldest first.
	globalThis.__piRunDueTimers = () => {
		let fired = 0;
		for (let round = 0; round < 10000; round++) {
			let next = null;
			for (const [id, timer] of timers) {
				if (next === null || timer.at < next.at) next = { id, at: timer.at };
			}
			if (!next) break;
			timerNow = next.at;
			const timer = timers.get(next.id);
			if (!timer) continue;
			if (timer.period === null) timers.delete(next.id);
			else timer.at = timerNow + timer.period;
			try {
				timer.callback(...timer.args);
			} catch (error) {
				console.error(error);
			}
			fired++;
		}
		return fired;
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
