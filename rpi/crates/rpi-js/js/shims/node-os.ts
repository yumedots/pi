export const homedir = () => process.env.HOME ?? process.env.USERPROFILE ?? "/";
export const tmpdir = () => process.env.TMPDIR ?? "/tmp";
export const platform = () => process.platform;
export const arch = () => process.arch;
export const EOL = "\n";

export const hostname = (): string => "localhost";
export const userInfo = (): { username: string; homedir: string; shell: string } => ({
	username: process.env.USER ?? process.env.LOGNAME ?? "user",
	homedir: homedir(),
	shell: process.env.SHELL ?? "/bin/sh",
});
export const release = (): string => "";
export const version = (): string => "";
export const uptime = (): number => 0;
export const loadavg = (): number[] => [0, 0, 0];
export const networkInterfaces = (): Record<string, unknown> => ({});
export const cpus = (): unknown[] => [];
export const endianness = (): string => "LE";
export const type = (): string => "Linux";
export const freemem = (): number => 0;
export const totalmem = (): number => 0;
export const devNull = "/dev/null";

/// The error numbers Node's `constants` module publishes.
export const constants = {
	E2BIG: 7,
	EACCES: 13,
	EAGAIN: 11,
	EBADF: 9,
	EBUSY: 16,
	EEXIST: 17,
	EFAULT: 14,
	EINTR: 4,
	EINVAL: 22,
	EISDIR: 21,
	ELOOP: 40,
	EMFILE: 24,
	ENAMETOOLONG: 36,
	ENOENT: 2,
	ENOMEM: 12,
	ENOSPC: 28,
	ENOTDIR: 20,
	ENOTEMPTY: 39,
	EPERM: 1,
	EPIPE: 32,
	ERANGE: 34,
	EROFS: 30,
	ESPIPE: 29,
	EXDEV: 18,
};
export default {
	homedir,
	tmpdir,
	platform,
	arch,
	hostname,
	userInfo,
	release,
	version,
	uptime,
	loadavg,
	networkInterfaces,
	cpus,
	endianness,
	type,
	freemem,
	totalmem,
	devNull,
	EOL,
	constants,
};
