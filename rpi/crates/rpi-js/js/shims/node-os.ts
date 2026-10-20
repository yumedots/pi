export const homedir = () => process.env.HOME ?? process.env.USERPROFILE ?? "/";
export const tmpdir = () => process.env.TMPDIR ?? "/tmp";
export const platform = () => process.platform;
export const arch = () => process.arch;
export const EOL = "\n";

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
export default { homedir, tmpdir, platform, arch, EOL, constants };
