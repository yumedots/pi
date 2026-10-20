#!/usr/bin/env node
// Probe: launch the program, send keys, print the pane.
//   node probe.mjs ts "keyspec" [settle] [keyspec2 settle2 ...]
// A keyspec is a colon separated list of tmux key names, e.g. "/settings:Enter:Down".
import { startMockServer } from "../mock-server.mjs";
import { runScreen } from "./harness.mjs";

const side = process.argv[2] ?? "ts";
const rest = process.argv.slice(3);
const specs = [];
for (let index = 0; index < rest.length; index += 2) {
	specs.push({ keys: rest[index] === "" ? [] : rest[index].split(":"), settle: Number(rest[index + 1] ?? 2000) });
}

const mock = await startMockServer({ turns: [{ type: "text", text: "Hello from the parity mock." }] });
for (const [index, spec] of specs.entries()) {
	const result = runScreen({
		side,
		spec: {
			name: `probe${index}`,
			steps: [{ name: "capture", keys: spec.keys, settle: spec.settle }],
		},
		mockBaseUrl: mock.baseUrl,
	});
	console.log(`######## ${spec.keys.join(" ")}`);
	console.log(result.pane.join("\n"));
}
await mock.close();
