export const pathToFileURL = (value: string) => ({
	href: `file://${value}`,
	pathname: value,
	protocol: "file:",
	toString: () => `file://${value}`,
});

export const fileURLToPath = (value: string | { pathname: string }) =>
	typeof value === "string" ? value.replace(/^file:\/\//, "") : value.pathname;

export default { pathToFileURL, fileURLToPath };
