export const homedir = () => process.env.HOME ?? process.env.USERPROFILE ?? "/";
export const tmpdir = () => process.env.TMPDIR ?? "/tmp";
export const platform = () => process.platform;
export const EOL = "\n";
export default { homedir, tmpdir, platform, EOL };
