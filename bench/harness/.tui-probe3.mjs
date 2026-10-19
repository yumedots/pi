const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB`);
const tui = "/Users/gabriel/pi/packages/tui/dist/components";

log("start");
await import(`${tui}/text.js`);
log("after the tui text");
await import(`${tui}/box.js`);
log("after the tui box");
await import(`${tui}/stack.js`);
log("after the tui stack");
await import(`${tui}/spacer.js`);
log("after the tui spacer");
await import(`${tui}/mouse-region.js`);
log("after the tui mouse region");
await import("/Users/gabriel/pi/packages/tui/dist/index.js");
log("after the tui barrel");
