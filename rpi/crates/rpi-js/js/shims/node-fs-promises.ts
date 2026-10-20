import fs from "./node-fs.ts";

const { promises } = fs;

const readFile = promises.readFile;
const writeFile = promises.writeFile;
const exists = promises.exists;
const readdir = promises.readdir;
const stat = promises.stat;
const open = promises.open;
const mkdir = promises.mkdir;
const rm = promises.rm;
const unlink = promises.unlink;
const rename = promises.rename;
const copyFile = promises.copyFile;
const access = promises.access;
const realpath = promises.realpath;
const appendFile = promises.appendFile;
const mkdtemp = promises.mkdtemp;

const fsPromises = {
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

export = fsPromises;
