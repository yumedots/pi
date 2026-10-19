// Shared lifecycle for the TypeScript 7 API used by the check scripts.
//
// The scripts use `typescript/unstable/async` rather than
// `typescript/unstable/sync`. The synchronous API talks to the tsgo server
// over a pipe it reads synchronously through `child.stdout._handle.fd`, a
// Node internal that Bun does not expose, so it only works on Node. The
// asynchronous API speaks JSON-RPC over a stream and runs on both.

import { API } from "typescript/unstable/async";

/** Create the TypeScript API with the virtual file system callbacks a script needs. */
export function createTypeScriptApi(options) {
	return new API(options);
}

/**
 * Close the API.
 *
 * The client disposes the JSON-RPC connection, which rejects the requests
 * that are still in flight. Under Bun the response callback of the last
 * request has not run when close() is reached, so the loop is drained first.
 */
export async function closeTypeScriptApi(api) {
	await new Promise((resolve) => setTimeout(resolve, 0));
	try {
		await api.close();
	} catch (error) {
		// Disposing the connection rejects the pending responses it tears down.
		// The work the script asked for is already done at this point.
		if (!/Pending response rejected since connection got disposed/.test(String(error?.message))) throw error;
	}
}
