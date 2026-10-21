#!/usr/bin/env node
/**
 * Summarizes the measurements of token-usage.mjs: the mean over the runs, per runtime
 * and per turn, with the raw numbers of every run beside the summary.
 *
 * Usage:
 *   node bench/tokens/summarize.mjs bench/tokens/results/rust-vs-ts-single.json [...]
 *   node bench/tokens/summarize.mjs --markdown bench/tokens/results/rust-vs-ts-single.json [...]
 */
import { readFileSync } from "node:fs";

const markdown = process.argv[2] === "--markdown";
const paths = process.argv.slice(markdown ? 3 : 2);
const NAMES = { node: "TypeScript agent", rpi: "Rust port", bun: "TypeScript agent (bun)" };

function mean(values) {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value) {
	if (value === null || value === undefined) return "-";
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The request of a turn that carries the tools: the request the model answers. */
function turnRequest(turn) {
	const withTools = turn.requests.filter((request) => request.carriesTools);
	return withTools.at(-1) ?? turn.requests.at(-1);
}

/** The requests of a turn that carry no tools: the auxiliary ones (the summary). */
function auxiliaryRequests(turn) {
	return turn.requests.filter((request) => !request.carriesTools);
}

function collect(path) {
	const result = JSON.parse(readFileSync(path, "utf8"));
	const runtimes = [...new Set(result.runs.map((run) => run.runtime))];
	const turns = Math.max(...result.runs.map((run) => run.turns.length));
	const rows = [];
	for (let turn = 0; turn < turns; turn++) {
		for (const runtime of runtimes) {
			const runs = result.runs.filter((run) => run.runtime === runtime);
			const entries = runs.map((run) => run.turns[turn]).filter(Boolean);
			const requests = entries.map(turnRequest).filter(Boolean);
			if (requests.length === 0) continue;
			const pick = (reader) => requests.map(reader);
			const systemParts = [...new Set(requests.flatMap((r) => r.system.parts.map((p) => p.label)))];
			const toolParts = [...new Set(requests.flatMap((r) => r.tools.parts.map((p) => p.label)))];
			const messageParts = [...new Set(requests.flatMap((r) => r.messages.parts.map((p) => p.label)))];
			rows.push({
				runtime,
				turn,
				prompt: entries[0]?.prompt ?? "",
				requests: entries.map((entry) => entry.requests.length),
				server: pick((r) => r.server?.promptTokens ?? null),
				cached: pick((r) => r.server?.cachedTokens ?? null),
				output: pick((r) => r.server?.completionTokens ?? null),
				counted: pick((r) => r.countedTotal),
				system: pick((r) => r.system.tokens),
				tools: pick((r) => r.tools.tokens),
				messages: pick((r) => r.messages.tokens),
				systemParts: systemParts.map((label) => ({
					label,
					values: pick((r) => r.system.parts.find((p) => p.label === label)?.tokens ?? 0),
				})),
				toolParts: toolParts.map((label) => ({
					label,
					values: pick((r) => r.tools.parts.find((p) => p.label === label)?.tokens ?? 0),
				})),
				messageParts: messageParts.map((label) => ({
					label,
					values: pick((r) => r.messages.parts.find((p) => p.label === label)?.tokens ?? 0),
				})),
				auxiliary: entries.map((entry) => auxiliaryRequests(entry)),
			});
		}
	}
	return { result, rows };
}

/** The cell of a table: the mean, with the raw numbers of every run. */
function cell(values) {
	const list = values.filter((value) => value !== null && value !== undefined);
	if (list.length === 0) return "-";
	return `${format(mean(list))} (${list.join(", ")})`;
}

function hitRate(row) {
	const rates = row.server
		.map((prompt, index) => (prompt ? ((row.cached[index] ?? 0) / prompt) * 100 : null))
		.filter((value) => value !== null);
	if (rates.length === 0) return "-";
	return `${format(mean(rates))}%`;
}

for (const path of paths) {
	const { result, rows } = collect(path);
	if (!markdown) {
		console.log(`\n# ${path}`);
		console.log(`scenario=${result.scenario} prompt=${JSON.stringify(result.prompt)}`);
		for (const row of rows) {
			console.log(`\n${row.runtime} turn ${row.turn}: ${row.prompt}`);
			console.log(
				`  server prompt mean=${format(mean(row.server))} raw=[${row.server.join(", ")}]` +
					`  cached mean=${format(mean(row.cached))} raw=[${row.cached.join(", ")}]` +
					`  output mean=${format(mean(row.output))} raw=[${row.output.join(", ")}]` +
					`  hit=${hitRate(row)}`,
			);
			console.log(
				`  counted mean=${format(mean(row.counted))} raw=[${row.counted.join(", ")}]` +
					`  system mean=${format(mean(row.system))} raw=[${row.system.join(", ")}]` +
					`  tools mean=${format(mean(row.tools))} raw=[${row.tools.join(", ")}]` +
					`  messages mean=${format(mean(row.messages))} raw=[${row.messages.join(", ")}]`,
			);
			for (const part of [...row.systemParts, ...row.toolParts, ...row.messageParts]) {
				console.log(`    ${part.label.padEnd(26)} mean=${format(mean(part.values))} raw=[${part.values.join(", ")}]`);
			}
			const auxiliary = row.auxiliary.filter((list) => list.length > 0);
			if (auxiliary.length > 0) {
				console.log(
					`    auxiliary: count=[${auxiliary.map((list) => list.length).join(", ")}]` +
						`  prompt=[${auxiliary.map((list) => list.map((r) => r.server?.promptTokens ?? 0).join("+")).join(", ")}]` +
						`  output=[${auxiliary.map((list) => list.map((r) => r.server?.completionTokens ?? 0).join("+")).join(", ")}]`,
				);
			}
			console.log(`    requests per turn: raw=[${row.requests.join(", ")}]`);
		}
		continue;
	}

	const runtimes = [...new Set(rows.map((row) => row.runtime))];
	const columns = runtimes.map((runtime) => NAMES[runtime] ?? runtime);
	const turns = [...new Set(rows.map((row) => row.turn))];
	for (const turn of turns) {
		const turnRows = rows.filter((row) => row.turn === turn);
		console.log(`\n### ${result.scenario}, turn ${turn}: ${turnRows[0]?.prompt ?? ""}\n`);
		console.log(`| Part | ${columns.join(" | ")} |`);
		console.log(`| --- | ${columns.map(() => "---").join(" | ")} |`);
		const line = (label, reader, raw = false) => {
			const cells = runtimes.map((runtime) => {
				const values = reader(turnRows.filter((row) => row.runtime === runtime));
				return raw ? (values[0] ?? "-") : cell(values);
			});
			console.log(`| ${label} | ${cells.join(" | ")} |`);
		};
		const labels = [...new Set(turnRows.flatMap((row) => row.systemParts.map((part) => part.label)))];
		const toolLabels = [...new Set(turnRows.flatMap((row) => row.toolParts.map((part) => part.label)))];
		const messageLabels = [...new Set(turnRows.flatMap((row) => row.messageParts.map((part) => part.label)))];
		line("the system prompt", (list) => list[0]?.system ?? []);
		line("the tool declarations", (list) => list[0]?.tools ?? []);
		line("the conversation", (list) => list[0]?.messages ?? []);
		line("**the request (counted)**", (list) => list[0]?.counted ?? []);
		line("the request (server prompt tokens)", (list) => list[0]?.server ?? []);
		line("the prefix cache (server cached tokens)", (list) => list[0]?.cached ?? []);
		line("the cache hit rate", (list) => (list[0] ? [hitRate(list[0])] : []), true);
		line("the answer (server output tokens)", (list) => list[0]?.output ?? []);
		line("the requests per turn", (list) => (list[0] ? list[0].requests : []));
		for (const label of labels) {
			line(`&nbsp;&nbsp;${label}`, (list) => list[0]?.systemParts.find((part) => part.label === label)?.values ?? []);
		}
		for (const label of toolLabels) {
			line(`&nbsp;&nbsp;${label}`, (list) => list[0]?.toolParts.find((part) => part.label === label)?.values ?? []);
		}
		for (const label of messageLabels) {
			line(`&nbsp;&nbsp;${label}`, (list) => list[0]?.messageParts.find((part) => part.label === label)?.values ?? []);
		}
	}
}
