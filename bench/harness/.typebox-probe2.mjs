const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB`);

log("start");
await import("/Users/gabriel/pi/node_modules/typebox/build/typebox.mjs");
log("after the typebox builder alone");
const type = await import("/Users/gabriel/pi/node_modules/typebox/build/type/index.mjs");
log("after the typebox type helpers");
console.log("Type available:", typeof type.Type);
