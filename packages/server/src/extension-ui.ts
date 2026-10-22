/**
 * The extension UI the server draws.
 *
 * The extensions live in the server: it loads them and it draws what they draw. The parts
 * that need a terminal component (a custom header, a custom footer, a custom dialog)
 * cannot travel over the wire, so the server keeps the factory and renders it into lines.
 */

import type {
	ExtensionCustomFactory,
	ExtensionHeaderFactory,
} from "@earendil-works/pi-coding-agent/core/extensions/types";
import { FooterDataProvider } from "@earendil-works/pi-coding-agent/core/footer-data-provider";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import type { Theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import type { ServerSession } from "./session-registry.ts";

/**
 * The width the server renders with.
 *
 * The client does not tell the server how wide its terminal is, so the server picks a
 * width and the client re-wraps the lines it receives.
 */
export const SERVER_RENDER_WIDTH = 100;

/** The terminal the factories of the extensions get. */
type ServerTui = Parameters<ExtensionHeaderFactory>[0];

/** The component the factories of the extensions build. */
type ExtensionComponent = ReturnType<ExtensionHeaderFactory>;

/** The handle of an overlay the stub terminal hands out. */
type ServerOverlayHandle = ReturnType<ServerTui["showOverlay"]>;

/**
 * How long the server waits for a custom component.
 *
 * A factory builds its component in the background sometimes, so the server waits for it.
 */
const CUSTOM_TIMEOUT_MS = 1000;

/**
 * Draw the custom header of a session.
 *
 * @returns The lines of the header, or none when the session has no custom header.
 */
export function renderExtensionHeader(session: ServerSession, theme: Theme): string[] {
	const factory = session.controller.getExtensionHeaderFactory?.();
	if (!factory) return [];
	try {
		return drawComponent(factory(serverTui(), theme));
	} catch {
		return [];
	}
}

/**
 * Draw the custom footer of a session.
 *
 * @returns The lines of the footer, or none when the session has no custom footer.
 */
export function renderExtensionFooter(session: ServerSession, theme: Theme): string[] {
	const factory = session.controller.getExtensionFooterFactory?.();
	if (!factory) return [];
	const provider = new FooterDataProvider(session.runtime.session.sessionManager.getCwd());
	try {
		return drawComponent(factory(serverTui(), theme, provider));
	} catch {
		return [];
	} finally {
		try {
			provider.dispose();
		} catch {
			// A provider that fails to clean up must not take the render down.
		}
	}
}

/**
 * Draw the custom dialog of a session.
 *
 * @returns The lines of the dialog, or none when the session has no custom dialog.
 */
export async function renderExtensionCustom(
	session: ServerSession,
	theme: Theme,
	keybindings: KeybindingsManager,
): Promise<string[]> {
	const factory = session.controller.getExtensionCustomFactory?.();
	if (!factory) return [];
	const component = await customComponent(factory, theme, keybindings);
	if (!component) return [];
	return drawComponent(component);
}

/**
 * Draw a component of an extension.
 *
 * A component that fails must not take the render down, so the server answers with no
 * lines instead.
 */
function drawComponent(component: ExtensionComponent): string[] {
	try {
		return component.render(SERVER_RENDER_WIDTH);
	} catch {
		return [];
	} finally {
		try {
			component.dispose?.();
		} catch {
			// A component that fails to clean up must not take the render down.
		}
	}
}

/**
 * The component of a custom dialog.
 *
 * The factory hands the component over in two ways: it returns it, and it calls `done`
 * with it. The server takes the first one that arrives and gives up after a while.
 */
async function customComponent(
	factory: ExtensionCustomFactory,
	theme: Theme,
	keybindings: KeybindingsManager,
): Promise<ExtensionComponent | undefined> {
	const { promise, resolve } = Promise.withResolvers<ExtensionComponent | undefined>();
	let settled = false;
	const take = (value: unknown): void => {
		if (settled || !isComponent(value)) return;
		settled = true;
		resolve(value);
	};
	try {
		const returned = factory(serverTui(), theme, keybindings, take);
		void Promise.resolve(returned)
			.then(take)
			.catch(() => {});
	} catch {
		return undefined;
	}
	const timer = setTimeout(() => {
		if (settled) return;
		settled = true;
		resolve(undefined);
	}, CUSTOM_TIMEOUT_MS);
	timer.unref?.();
	try {
		return await promise;
	} finally {
		clearTimeout(timer);
	}
}

/** Whether a value is a component an extension built. */
function isComponent(value: unknown): value is ExtensionComponent {
	return typeof value === "object" && value !== null && typeof (value as ExtensionComponent).render === "function";
}

/**
 * The terminal the factories of the extensions get.
 *
 * The server has no terminal: the stub answers the calls a factory makes while it builds
 * a component and does nothing else. A factory that needs more fails, and the render
 * answers with no lines.
 */
function serverTui(): ServerTui {
	return {
		mode: "regular",
		children: [],
		terminal: {
			columns: SERVER_RENDER_WIDTH,
			rows: 24,
			write: () => {},
			setTitle: () => {},
			hideCursor: () => {},
			showCursor: () => {},
			clearLine: () => {},
			clearScreen: () => {},
			moveBy: () => {},
			setProgress: () => {},
		},
		fullRedraws: 0,
		render: () => [],
		invalidate: () => {},
		addChild: () => {},
		removeChild: () => {},
		clear: () => {},
		getShowHardwareCursor: () => false,
		setShowHardwareCursor: () => {},
		getClearOnShrink: () => false,
		setClearOnShrink: () => {},
		setFocus: () => {},
		showOverlay: () => serverOverlayHandle(),
		hideOverlay: () => {},
		hasOverlay: () => false,
		start: () => {},
		stop: () => {},
		renderNow: () => {},
		requestRender: () => {},
		addInputListener: () => () => {},
		removeInputListener: () => {},
		onTerminalColorSchemeChange: () => () => {},
		setTerminalColorSchemeNotifications: () => {},
		queryTerminalColors: () => Promise.resolve({ foreground: undefined, background: undefined, palette: [] }),
	} as unknown as ServerTui;
}

/**
 * The handle of an overlay of the stub terminal.
 *
 * The server draws no overlay, so the handle does nothing.
 */
function serverOverlayHandle(): ServerOverlayHandle {
	return {
		hide: () => {},
		setHidden: () => {},
		isHidden: () => false,
		focus: () => {},
		unfocus: () => {},
		isFocused: () => false,
		getBounds: () => undefined,
	} as unknown as ServerOverlayHandle;
}
