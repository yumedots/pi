/**
 * The `ms` package: a duration in words, in milliseconds.
 *
 * The host has no node_modules, so an npm package an extension imports is
 * either published here or missing. `ms` is small, pure and has no
 * dependencies, so the host publishes it.
 */

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const YEAR = DAY * 365.25;

const UNITS: Record<string, number> = {
	ms: 1,
	msec: 1,
	msecs: 1,
	millisecond: 1,
	milliseconds: 1,
	s: SECOND,
	sec: SECOND,
	secs: SECOND,
	second: SECOND,
	seconds: SECOND,
	m: MINUTE,
	min: MINUTE,
	mins: MINUTE,
	minute: MINUTE,
	minutes: MINUTE,
	h: HOUR,
	hr: HOUR,
	hrs: HOUR,
	hour: HOUR,
	hours: HOUR,
	d: DAY,
	day: DAY,
	days: DAY,
	w: DAY * 7,
	week: DAY * 7,
	weeks: DAY * 7,
	y: YEAR,
	yr: YEAR,
	yrs: YEAR,
	year: YEAR,
	years: YEAR,
};

const LONG_UNITS: [number, string][] = [
	[YEAR, "year"],
	[DAY, "day"],
	[HOUR, "hour"],
	[MINUTE, "minute"],
	[SECOND, "second"],
	[1, "millisecond"],
];

const DURATION = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const format = (value: number, long: boolean): string => {
	const count = Math.round(value);
	if (!long) return `${count}ms`;
	for (const [size, name] of LONG_UNITS) {
		if (count >= size) {
			const amount = Math.round(count / size);
			return `${amount} ${name}${amount === 1 ? "" : "s"}`;
		}
	}
	return `${count} ms`;
};

const parse = (text: string): number | undefined => {
	if (text.length > 100) return undefined;
	const match = DURATION.exec(text);
	if (!match) return undefined;
	const amount = Number.parseFloat(match[1]);
	if (!Number.isFinite(amount)) return undefined;
	const unit = (match[2] ?? "ms").toLowerCase();
	const size = UNITS[unit];
	if (size === undefined) return undefined;
	return amount * size;
};

/**
 * The duration in milliseconds.
 *
 * A string is parsed (`"2 days"`), a number is returned as it is. A string
 * that is not a duration answers `undefined`, the way the package does.
 */
const ms = (value: string | number, options?: { long?: boolean }): number | string | undefined => {
	if (typeof value === "string" && value.length > 0) return parse(value);
	if (typeof value === "number" && Number.isFinite(value)) {
		return options?.long ? format(value, true) : format(value, false);
	}
	throw new Error(`val is not a non-empty string or a valid number. val=${JSON.stringify(value)}`);
};

export default ms;
export { ms };
