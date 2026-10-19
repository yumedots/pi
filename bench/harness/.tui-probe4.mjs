const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB`);
const tui = "/Users/gabriel/pi/packages/tui/dist";

log("start");
await import(`${tui}/components/text.js`);
log("after the tui text");
await import(`${tui}/tui.js`);
log("after the tui main module");
await import(`${tui}/index.js`);
log("after the tui barrel");
