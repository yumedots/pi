import { promises } from "./node-fs.ts";

export const readFile = promises.readFile;
export const writeFile = promises.writeFile;
export const exists = promises.exists;
export const readdir = promises.readdir;
export const stat = promises.stat;
export const open = promises.open;
export const mkdir = promises.mkdir;
export const rm = promises.rm;
export const unlink = promises.unlink;
export const rename = promises.rename;
export const copyFile = promises.copyFile;
export const access = promises.access;
export const realpath = promises.realpath;
export const appendFile = promises.appendFile;
export const mkdtemp = promises.mkdtemp;

export default {
	readFile,
	writeFile,
	exists,
	readdir,
	stat,
	open,
	mkdir,
	rm,
	unlink,
	rename,
	copyFile,
	access,
	realpath,
	appendFile,
	mkdtemp,
};
