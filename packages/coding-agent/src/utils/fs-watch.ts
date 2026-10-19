import { type FSWatcher, type WatchListener, watch } from "node:fs";

export const FS_WATCH_RETRY_DELAY_MS = 5000;

export function closeWatcher(watcher: FSWatcher | null | undefined): void {
	if (!watcher) {
		return;
	}

	try {
		watcher.close();
	} catch {
		// Ignore watcher close errors
	}
}

export function watchWithErrorHandler(
	path: string,
	listener: WatchListener<string>,
	onError: () => void,
): FSWatcher | null {
	try {
		// The listener is registered on the emitter instead of passed to watch(), so the
		// watcher behaves the same on every runtime: Node hands the listener to watch()
		// and keeps it out of the emitter's listener list, Bun does the opposite.
		const watcher = watch(path);
		watcher.on("change", listener);
		watcher.on("error", onError);
		return watcher;
	} catch {
		onError();
		return null;
	}
}
