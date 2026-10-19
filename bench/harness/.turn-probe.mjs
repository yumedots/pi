import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const child = spawn("bun", ["packages/coding-agent/src/cli.ts", "--mode", "rpc", "--no-session", "--model", "local/smollm2-1.7b-instruct"], {
	cwd: "/Users/gabriel/pi",
	env: { ...process.env, PI_CODING_AGENT_DIR: "/tmp/pi-bench-agent" },
	stdio: ["pipe", "pipe", "inherit"],
});

const samples = [];
let buffer = "";
let sentAt = 0;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const rss = Number.parseInt(
			require("node:child_process").execSync(`ps -o rss= -p ${child.pid}`, { encoding: "utf8" }).trim(),
			10,
		);
		samples.push({ at: Math.round(performance.now() - sentAt), type: event.type, rss });
		if (event.type === "response" && event.command === "get_state") {
			sentAt = performance.now();
			child.stdin.write(`${JSON.stringify({ id: "p", type: "prompt", message: "Say hello in three words" })}\n`);
		}
		if (event.type === "agent_settled") {
			child.stdin.end();
		}
	}
});
child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
child.once("close", () => {
	for (const sample of samples) {
		console.log(`${String(sample.at).padStart(6)}ms ${sample.rss}MB  ${sample.type}`);
	}
});
