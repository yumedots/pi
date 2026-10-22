/**
 * The server's session registry.
 *
 * One `AgentSessionRuntime` per session, because pi's runtime is single-session by design.
 * The registry owns the sessions, their controllers and their trust decisions.
 */

import { dirname, join } from "node:path";
import type { AgentSessionEvent, RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
	getDefaultSessionDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	SessionController,
	SessionManager,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { clearTurnClaim, readTurnClaim, writeTurnClaim } from "./turn-claim.ts";

/** A session the server hosts. */
export interface ServerSession {
	/** The session id. */
	id: string;
	/** The working directory of the session. */
	cwd: string;
	/** The runtime that owns the session. */
	runtime: AgentSessionRuntime;
	/** The controller that drives the session. */
	controller: SessionController;
	/** The session file, or `undefined` for an in-memory session. */
	sessionFile: string | undefined;
	/** Whether the session is working right now. */
	busy: boolean;
}

/** The dependencies of a {@link SessionRegistry}. */
export interface SessionRegistryDeps {
	/** The agent directory that holds the trust store. */
	agentDir: string;
	/** The factory that builds runtimes. */
	createRuntime: CreateAgentSessionRuntimeFactory;
	/** The settings manager that carries the project trust policy. */
	settingsManager: SettingsManager;
	/** The trust store, where the client's trust decisions live. */
	trustStore?: ProjectTrustStore;
	/** Called for every event of every session. */
	onEvent?: (sessionId: string, event: AgentSessionEvent) => void;
	/** Answers an extension UI request for a session. */
	requestExtensionUi?: (sessionId: string, request: RpcExtensionUIRequest) => Promise<RpcExtensionUIResponse>;
}

/**
 * The server refused to open a session because the project is not trusted.
 */
export class ProjectNotTrustedError extends Error {
	readonly _tag = "ProjectNotTrustedError";

	constructor(cwd: string) {
		super(`project is not trusted; run pi in this directory to decide: ${cwd}`);
		this.name = "ProjectNotTrustedError";
	}
}

/**
 * The sessions the server hosts.
 */
export class SessionRegistry {
	private readonly deps: SessionRegistryDeps;
	private readonly trustStore: ProjectTrustStore;
	private readonly sessionMap = new Map<string, ServerSession>();

	constructor(deps: SessionRegistryDeps) {
		this.deps = deps;
		this.trustStore = deps.trustStore ?? new ProjectTrustStore(deps.agentDir);
	}

	/** The live sessions, keyed by session id. */
	get sessions(): ReadonlyMap<string, ServerSession> {
		return this.sessionMap;
	}

	/**
	 * Open an existing session file.
	 */
	async open(sessionPath: string): Promise<ServerSession> {
		const sessionManager = SessionManager.open(sessionPath);
		const cwd = sessionManager.getCwd();
		this.assertTrusted(cwd);
		return this.attach(cwd, sessionManager);
	}

	/**
	 * Create a new session for a directory.
	 */
	async create(cwd: string, sessionDir?: string): Promise<ServerSession> {
		this.assertTrusted(cwd);
		return this.attach(cwd, SessionManager.create(cwd, sessionDir));
	}

	/**
	 * Continue the most recent session of a directory.
	 */
	async continueRecent(cwd: string): Promise<ServerSession> {
		this.assertTrusted(cwd);
		const sessionManager = SessionManager.continueRecent(cwd);
		return this.attach(sessionManager.getCwd(), sessionManager);
	}

	/**
	 * The session with this id.
	 */
	get(id: string): ServerSession | undefined {
		return this.sessionMap.get(id);
	}

	/**
	 * List the sessions the server knows about.
	 *
	 * The sessions on disk, plus the ones the server hosts right now: a session that has not
	 * written its file yet has no entry on disk, but the user is working in it.
	 *
	 * @param cwd When given, only the sessions of that directory are listed.
	 */
	async list(cwd?: string): Promise<ServerInfo[]> {
		// The sessions of the agent directory the registry was built with, not of whatever
		// the environment points at. The session files live one level below the sessions
		// root, in the directory that encodes the project.
		const sessionsRoot = join(this.deps.agentDir, "sessions");
		const sessions = cwd
			? await SessionManager.list(cwd, getDefaultSessionDir(cwd, this.deps.agentDir))
			: await SessionManager.listAll(sessionsRoot);
		const listed = new Map(
			sessions.map((session) => [
				session.id,
				{
					id: session.id,
					path: session.path,
					cwd: session.cwd,
					name: session.name,
					created: session.created.getTime(),
					modified: session.modified.getTime(),
					messageCount: session.messageCount,
					firstMessage: session.firstMessage,
					allMessagesText: session.allMessagesText,
					busy: this.sessionMap.get(session.id)?.busy ?? false,
				},
			]),
		);

		for (const session of this.sessionMap.values()) {
			if (listed.has(session.id)) continue;
			if (cwd !== undefined && session.cwd !== cwd) continue;
			listed.set(session.id, {
				id: session.id,
				path: session.sessionFile ?? "",
				cwd: session.cwd,
				name: session.runtime.session.sessionName,
				created: Date.now(),
				modified: Date.now(),
				messageCount: session.runtime.session.messages.length,
				firstMessage: "",
				allMessagesText: "",
				busy: session.busy,
			});
		}

		return [...listed.values()].sort((a, b) => b.modified - a.modified);
	}

	/**
	 * Close a session and release its runtime.
	 */
	async close(id: string): Promise<void> {
		const session = this.sessionMap.get(id);
		if (!session) return;
		this.sessionMap.delete(id);
		session.controller.dispose();
		await session.runtime.dispose();
	}

	/**
	 * Close every session.
	 */
	async closeAll(): Promise<void> {
		for (const id of [...this.sessionMap.keys()]) {
			await this.close(id);
		}
	}

	/**
	 * Whether any session is working right now.
	 */
	get busy(): boolean {
		for (const session of this.sessionMap.values()) {
			if (session.busy) return true;
		}
		return false;
	}

	/**
	 * Refuse a project the headless server may not open.
	 *
	 * The server never prompts. It reads the trust policy and the trust store, where the
	 * client recorded its decision.
	 */
	private assertTrusted(cwd: string): void {
		if (!hasTrustRequiringProjectResources(cwd)) return;
		const policy = this.deps.settingsManager.getDefaultProjectTrust();
		if (policy === "always") return;
		if (policy === "never") throw new ProjectNotTrustedError(cwd);
		if (this.trustStore.get(cwd) === true) return;
		throw new ProjectNotTrustedError(cwd);
	}

	private async attach(cwd: string, sessionManager: SessionManager): Promise<ServerSession> {
		const runtime = await createAgentSessionRuntime(this.deps.createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir: this.deps.agentDir,
			sessionManager,
		});
		const session = runtime.session;
		const id = session.sessionId;

		const controller = new SessionController(
			runtime,
			{
				onEvent: (event) => {
					this.refreshBusy(session);
					if (event.type === "agent_settled") this.clearClaim(id);
					this.deps.onEvent?.(id, event);
				},
				requestExtensionUi: (request) => {
					if (!this.deps.requestExtensionUi) {
						return Promise.resolve({ type: "extension_ui_response", id: request.id, cancelled: true });
					}
					return this.deps.requestExtensionUi(id, request);
				},
				onSessionRebind: () => {
					const current = this.sessionMap.get(id);
					if (current) current.busy = session.isStreaming || session.isCompacting;
				},
				// The server draws the terminal UI of the extensions, so the extensions see the
				// host they are really in.
			},
			"tui",
		);
		await controller.rebind();

		const handle = controller.handle.bind(controller);
		controller.handle = async (command) => {
			const response = await handle(command);
			if (response && "data" in response && response.data && typeof response.data === "object") {
				const disposition = (response.data as { disposition?: string }).disposition;
				if (disposition === "started" || disposition === "queued") this.writeClaim(id);
			}
			return response;
		};

		const serverSession: ServerSession = {
			id,
			cwd,
			runtime,
			controller,
			sessionFile: session.sessionFile,
			busy: session.isStreaming || session.isCompacting,
		};
		this.sessionMap.set(id, serverSession);
		return serverSession;
	}

	/**
	 * Write the claim of a session whose turn just started.
	 *
	 * The claim is what tells the next server that this turn was interrupted.
	 */
	private writeClaim(id: string): void {
		const serverSession = this.sessionMap.get(id);
		if (!serverSession?.sessionFile) return;
		const sessionDir = dirname(serverSession.sessionFile);
		// The attempt counter belongs to the claim: the recovery sweep raises it before it
		// resumes a turn, and a fresh turn must not reset it.
		const existing = readTurnClaim(sessionDir, id);
		writeTurnClaim({
			sessionId: id,
			cwd: serverSession.cwd,
			sessionFile: serverSession.sessionFile,
			startedAt: existing?.startedAt ?? Date.now(),
			pid: process.pid,
			attempt: existing?.attempt ?? 0,
		});
	}

	/**
	 * Remove the claim of a session whose turn ended.
	 */
	private clearClaim(id: string): void {
		const serverSession = this.sessionMap.get(id);
		if (!serverSession?.sessionFile) return;
		clearTurnClaim(dirname(serverSession.sessionFile), id);
	}

	/**
	 * Record that a turn started, so a crash leaves a claim behind.
	 *
	 * @returns `true` when the turn started and the claim was written.
	 */
	noteTurnStarted(sessionId: string, disposition: string): boolean {
		if (disposition !== "started") return false;
		this.writeClaim(sessionId);
		return true;
	}

	private refreshBusy(session: { isStreaming: boolean; isCompacting: boolean }): void {
		for (const serverSession of this.sessionMap.values()) {
			if (serverSession.runtime.session !== session) continue;
			serverSession.busy = session.isStreaming || session.isCompacting;
		}
	}
}

/** A session as the server lists it. */
export interface ServerInfo {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
	busy: boolean;
}
