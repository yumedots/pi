globalThis.__piRun = (source) => {
	try {
		(0, eval)(source);
		return JSON.stringify({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? String(error.stack ?? error.message) : String(error);
		return JSON.stringify({ ok: false, error: message });
	}
};
