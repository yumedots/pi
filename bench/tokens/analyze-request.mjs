import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2] ?? "/tmp/pi-request.txt", "utf8");
const marker = "\r\n\r\n";
const index = raw.indexOf(marker);
const body = index < 0 ? raw : raw.slice(index + marker.length);
const payload = JSON.parse(body);

const server = process.env.PI_LLAMA_URL ?? "http://127.0.0.1:8081";

async function countTokens(text) {
	const response = await fetch(`${server}/tokenize`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content: text }),
	});
	const result = await response.json();
	return result.tokens?.length ?? 0;
}

const parts = [];
for (const message of payload.messages ?? []) {
	const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
	parts.push({ label: `message:${message.role}`, chars: text.length, tokens: await countTokens(text) });
}
for (const tool of payload.tools ?? []) {
	const text = JSON.stringify(tool);
	parts.push({ label: `tool:${tool.function?.name ?? tool.name}`, chars: text.length, tokens: await countTokens(text) });
}
parts.push({ label: "model+params", chars: 0, tokens: await countTokens(JSON.stringify({ model: payload.model, stream: payload.stream })) });

let totalChars = 0;
let totalTokens = 0;
for (const part of parts) {
	totalChars += part.chars;
	totalTokens += part.tokens;
	console.log(
		`${part.label.padEnd(28)} chars=${String(part.chars).padStart(7)} tokens=${String(part.tokens).padStart(6)}`,
	);
}
console.log(`${"TOTAL".padEnd(28)} chars=${String(totalChars).padStart(7)} tokens=${String(totalTokens).padStart(6)}`);
console.log(`\npayload bytes: ${body.length}`);
console.log(`tools: ${(payload.tools ?? []).length}`);
