/**
 * The bug report of the client.
 *
 * A bug report bundles what the user saw with what the client knows about itself: the
 * environment, the model, the extensions, the settings and the diagnostics of the
 * session. The client writes the bundle and hands it to the server, which uploads it or
 * writes it as a zip archive.
 *
 * The copy in the client is the copy of the coding agent, without the part that writes
 * the summary: the model runs in the server's process, so the server writes the summary.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import { crc32, deflateRawSync } from "node:zlib";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, Provider } from "@earendil-works/pi-ai";
import { getPiUserAgent } from "@earendil-works/pi-support/pi-user-agent";
import type { ServerSettings } from "../client-settings.ts";
import { VERSION } from "./config.ts";
import type { CrashRecord } from "./crash-log.ts";
import type { SessionEntry } from "./session-manager.ts";

export const BUG_REPORT_CUSTOM_ENTRY_TYPE = "pi.bug-report";
const BUG_REPORT_SCHEMA_VERSION = 1;
const REDACTED = "<redacted>";
const SENSITIVE_KEY = /(?:^|[-_])(api[-_]?key|secret|token|password|passwd|credential|authorization|cookie)(?:$|[-_])/i;

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
}

/** Strip credentials and secret-looking query parameters from a URL. */
export function redactUrl(value: string): string {
	const nested = /^([a-z][a-z0-9+.-]*:)([a-z][a-z0-9+.-]*:\/\/.*)$/i.exec(value);
	if (nested) return `${nested[1]}${redactUrl(nested[2])}`;
	try {
		const url = new URL(value);
		let changed = false;
		if (url.username || url.password) {
			url.username = "";
			url.password = "";
			changed = true;
		}
		for (const key of url.searchParams.keys()) {
			if (isSensitiveKey(key)) {
				url.searchParams.set(key, REDACTED);
				changed = true;
			}
		}
		return changed ? url.toString() : value;
	} catch {
		return value;
	}
}

/** Copy a JSON value while removing values that may contain credentials. */
export function redactJsonValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	return JSON.parse(
		JSON.stringify(value, (key, child: unknown) => {
			if (child !== null && child !== undefined && isSensitiveKey(key)) return REDACTED;
			return typeof child === "string" ? redactUrl(child) : child;
		}),
	);
}

function redactSettings(settings: ServerSettings): ServerSettings {
	const { deviceId: _deviceId, ...rest } = settings;
	return redactJsonValue(rest) as ServerSettings;
}

function collectEnvironment() {
	const env = (name: string): string | null => process.env[name] || null;
	return {
		version: VERSION,
		userAgent: getPiUserAgent(VERSION),
		runtime: process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`,
		platform: process.platform,
		arch: process.arch,
		osRelease: os.release(),
		osVersion: os.version(),
		shell: process.env.SHELL?.split(/[\\/]/).pop() || null,
		terminal: {
			term: env("TERM"),
			program: env("TERM_PROGRAM"),
			programVersion: env("TERM_PROGRAM_VERSION"),
			colorterm: env("COLORTERM"),
			tmux: Boolean(process.env.TMUX),
			ssh: Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY),
			ci: Boolean(process.env.CI),
		},
		// Names help diagnose configuration; values never leave the machine.
		piEnvironmentVariables: Object.keys(process.env)
			.filter((name) => name.startsWith("PI_"))
			.sort(),
	};
}

function describeModel(model: Model<any>) {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: redactUrl(model.baseUrl),
		reasoning: model.reasoning,
		input: model.input,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		samplingParams: model.samplingParams ? redactJsonValue(model.samplingParams) : null,
		compat: model.compat ? redactJsonValue(model.compat) : null,
		thinkingLevelMap: model.thinkingLevelMap ?? null,
		headerNames: Object.keys(model.headers ?? {}).sort(),
	};
}

/** The part of the model runtime the bug report reads. */
export interface BugReportModelRuntime {
	/** The provider of an id. */
	getProvider(providerId: string): Provider | undefined;
	/** Whether the provider has credentials, and where they come from. */
	getProviderAuthStatus(providerId: string): { configured: boolean; source?: string; label?: string };
	/** Whether the provider is used with OAuth. */
	isUsingOAuth(providerId: string): boolean;
	/** The providers an extension registered. */
	getRegisteredProviderIds(): readonly string[];
}

function describeProvider(modelRuntime: BugReportModelRuntime, provider: Provider) {
	const authTypes: Array<"api_key" | "oauth"> = [];
	if (provider.auth.apiKey) authTypes.push("api_key");
	if (provider.auth.oauth) authTypes.push("oauth");
	return {
		id: provider.id,
		name: provider.name,
		baseUrl: provider.baseUrl ? redactUrl(provider.baseUrl) : null,
		headerNames: Object.keys(provider.headers ?? {}).sort(),
		authTypes,
		authStatus: modelRuntime.getProviderAuthStatus(provider.id),
		usingOAuth: modelRuntime.isUsingOAuth(provider.id),
		registeredByExtension: modelRuntime.getRegisteredProviderIds().includes(provider.id),
	};
}

/** An extension the report describes. */
export interface BugReportExtension {
	/** Where the extension comes from. */
	readonly path: string;
	/** Where the extension was loaded from. */
	readonly source?: string;
	/** The scope of the extension. */
	readonly scope?: string;
	/** The origin of the extension. */
	readonly origin?: string;
	/** Whether the extension is hidden. */
	readonly hidden?: boolean;
}

function describeExtension(extension: BugReportExtension) {
	return {
		path: extension.path,
		source: extension.source ? redactUrl(extension.source) : "",
		scope: extension.scope,
		origin: extension.origin,
		hidden: extension.hidden === true,
	};
}

interface CollectBugReportMetadataOptions {
	id?: string;
	hint?: string;
	sessionId: string;
	cwd: string;
	includeSession: boolean;
	includeSummary: boolean;
	messageCount: number;
	model?: Model<any>;
	modelRuntime: BugReportModelRuntime;
	thinkingLevel: ThinkingLevel;
	extensions: readonly BugReportExtension[];
	extensionErrors: ReadonlyArray<{ path: string; error: string }>;
	globalSettings: ServerSettings;
	projectSettings: ServerSettings;
}

export function collectBugReportMetadata(options: CollectBugReportMetadataOptions) {
	const hint = options.hint?.trim() || null;
	const provider = options.model ? options.modelRuntime.getProvider(options.model.provider) : undefined;
	return {
		schemaVersion: BUG_REPORT_SCHEMA_VERSION,
		id: options.id ?? randomUUID(),
		createdAt: new Date().toISOString(),
		hint,
		environment: collectEnvironment(),
		session: {
			id: options.sessionId,
			included: options.includeSession,
			summaryIncluded: options.includeSummary,
			messageCount: options.messageCount,
			...(options.includeSession ? { cwd: options.cwd } : {}),
		},
		model: options.model ? describeModel(options.model) : null,
		provider: provider ? describeProvider(options.modelRuntime, provider) : null,
		thinkingLevel: options.thinkingLevel,
		extensions: options.extensions.map(describeExtension),
		extensionErrors: options.extensionErrors.map(({ path, error }) => ({ path, error })),
		settings: {
			global: redactSettings(options.globalSettings),
			project: redactSettings(options.projectSettings),
		},
	};
}

/** The session the diagnostics are read from. */
export interface BugReportSessionReader {
	/** The entries of the session. */
	getEntries(): SessionEntry[];
	/** The id of the session. */
	getSessionId(): string;
}

/** Collect failed assistant turns without collecting conversation content. */
export function collectBugReportDiagnostics(
	sessionManager: BugReportSessionReader,
	crashes: readonly CrashRecord[] = [],
) {
	const entries = sessionManager.getEntries();
	const assistant = [];
	let assistantMessageCount = 0;
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		assistantMessageCount++;
		const message = entry.message;
		const diagnostics = message.diagnostics ?? [];
		if (
			diagnostics.length === 0 &&
			message.stopReason !== "error" &&
			message.stopReason !== "aborted" &&
			!message.errorMessage
		) {
			continue;
		}
		assistant.push({
			entryId: entry.id,
			timestamp: entry.timestamp,
			provider: message.provider,
			model: message.model,
			api: message.api,
			stopReason: message.stopReason,
			...(message.rawStopReason === undefined ? {} : { rawStopReason: message.rawStopReason }),
			...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
			diagnostics,
		});
	}
	return {
		schemaVersion: BUG_REPORT_SCHEMA_VERSION,
		sessionId: sessionManager.getSessionId(),
		entryCount: entries.length,
		assistantMessageCount,
		assistant,
		crashes: crashes.map(({ notified: _notified, ...record }) => record),
	};
}

export type BugReportMetadata = ReturnType<typeof collectBugReportMetadata>;
export type BugReportDiagnostics = ReturnType<typeof collectBugReportDiagnostics>;

export interface BugReportBundle {
	metadata: BugReportMetadata;
	diagnostics: BugReportDiagnostics;
	sessionJsonl?: string;
	summary?: string;
}

export interface BugReportSessionEntryData {
	id: string;
	createdAt: string;
	hint: string | null;
	sessionIncluded: boolean;
	summaryIncluded: boolean;
	delivery: "zip" | "upload";
	path?: string;
}

interface BugReportFile {
	name: string;
	contentType: string;
	data: string;
}

/** Files shared by upload and zip export. */
export function bugReportFiles(bundle: BugReportBundle): BugReportFile[] {
	const files: BugReportFile[] = [
		{ name: "report.json", contentType: "application/json", data: `${JSON.stringify(bundle.metadata, null, 2)}\n` },
		{
			name: "diagnostics.json",
			contentType: "application/json",
			data: `${JSON.stringify(bundle.diagnostics, null, 2)}\n`,
		},
	];
	if (bundle.sessionJsonl !== undefined) {
		files.push({ name: "session.jsonl", contentType: "application/x-ndjson", data: bundle.sessionJsonl });
	}
	if (bundle.summary !== undefined) {
		files.push({
			name: "summary.md",
			contentType: "text/markdown",
			data: bundle.summary.endsWith("\n") ? bundle.summary : `${bundle.summary}\n`,
		});
	}
	return files;
}

interface ZipEntry {
	name: string;
	data: string | Uint8Array;
}

function dosDateTime(date: Date): { time: number; day: number } {
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		day: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

/** Create the small, classic ZIP archives used by bug reports. */
function createZipArchive(entries: readonly ZipEntry[]): Buffer {
	const files: Buffer[] = [];
	const directory: Buffer[] = [];
	const { time, day } = dosDateTime(new Date());
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		const data = typeof entry.data === "string" ? Buffer.from(entry.data) : Buffer.from(entry.data);
		const compressed = deflateRawSync(data);
		const checksum = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(day, 12);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(day, 14);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);

		files.push(local, name, compressed);
		directory.push(central, name);
		offset += local.length + name.length + compressed.length;
	}

	const centralDirectory = Buffer.concat(directory);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...files, centralDirectory, end]);
}

export function writeBugReportArchive(bundle: BugReportBundle, filePath: string): Promise<void> {
	return writeFile(filePath, createZipArchive(bugReportFiles(bundle)));
}

export function bugReportArchiveFileName(id: string): string {
	return `pi-bug-report-${id}.zip`;
}
