import { readFileSync } from "node:fs";

const path = process.env.PI_PARITY_CLOCK;
if (path) {
	const virtual = () => {
		try {
			return Number.parseInt(readFileSync(path, "utf8").trim(), 10) || 0;
		} catch {
			return 0;
		}
	};
	performance.now = virtual;
}
