const unavailable = (name: string) => () => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const execSync = unavailable("execSync");
export const exec = unavailable("exec");
export const execFile = unavailable("execFile");
export const spawn = unavailable("spawn");
export const spawnSync = unavailable("spawnSync");
export default { execSync, exec, execFile, spawn, spawnSync };
