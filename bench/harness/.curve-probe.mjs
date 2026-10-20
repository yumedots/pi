import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const runtime = process.argv[2] ?? "node";
const seconds = Number.parseInt(process.argv[3] ?? "20", 10);
const pkg = "/Users/gabriel/pi/packages/coding-agent";
const args = runtime === "bun" ? [join(pkg, "src/cli.ts")] : [join(pkg, "dist/cli.js")];

const session = `pi-curve-${process.pid}`;
spawnSync("tmux", ["kill-session", "-t", session]);
spawnSync("tmux", [
	"new-session",
	"-d",
	"-s",
	session,
	"-x",
	"120",
	"-y",
	"40",
	"-c",
	"/Users/gabriel/pi",
	`${runtime === "bun" ? "bun" : "node"} ${args.join(" ")}`,
]);

const samples = [];
const started = Date.now();
const timer = setInterval(() => {
	const pane = spawnSync("tmux", ["list-panes", "-t", session, "-F", "#{pane_pid}"], { encoding: "utf8" }).stdout.trim();
	if (!pane) return;
	const children = spawnSync("pgrep", ["-P", pane], { encoding: "utf8" })
		.stdout.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const pid = children[0] ?? pane;
	const rss = Number.parseInt(spawnSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).stdout.trim(), 10);
	samples.push({ at: Math.round((Date.now() - started) / 100) / 10, mb: Math.round(rss / 1024) });
}, 500);

setTimeout(() => {
	clearInterval(timer);
	spawnSync("tmux", ["kill-session", "-t", session]);
	for (const sample of samples) process.stdout.write(`${sample.at}s ${sample.mb}MB\n`);
}, seconds * 1000);
