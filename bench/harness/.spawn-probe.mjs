import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const child = spawn(
	process.execPath,
	["/Users/gabriel/pi/packages/coding-agent/dist/cli.js", "--mode", "rpc", "--no-session", "--model", "local/smollm2-1.7b-instruct"],
	{
		cwd: "/Users/gabriel/pi",
		env: { ...process.env, PI_CODING_AGENT_DIR: "/tmp/pi-soak-dbg3" },
		stdio: ["pipe", "pipe", "inherit"],
	},
);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	process.stderr.write(`OUT ${chunk.length} bytes\n`);
});
child.on("exit", (code) => process.stderr.write(`EXIT ${code}\n`));
child.on("error", (error) => process.stderr.write(`ERROR ${error.message}\n`));
child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
process.stderr.write("wrote get_state\n");
setTimeout(() => {
	process.stderr.write("writing the prompt\n");
	child.stdin.write(`${JSON.stringify({ id: "p", type: "prompt", message: "Reply with the single word: ready" })}\n`);
}, 500);
setTimeout(() => {
	child.stdin.end();
}, 20000);
