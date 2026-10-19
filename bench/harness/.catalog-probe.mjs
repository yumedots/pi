const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const heap = () => Math.round(process.memoryUsage().heapUsed / 1048576);
const log = (label) => console.log(`${label.padEnd(46)} rss=${rss()}MB heap=${heap()}MB`);

log("start");
const data = await import("/Users/gabriel/pi/packages/ai/dist/providers/data/openrouter.json", { with: { type: "json" } });
log("after the openrouter model data");
const bedrock = await import("/Users/gabriel/pi/packages/ai/dist/providers/data/amazon-bedrock.json", { with: { type: "json" } });
log("after the bedrock model data");
const vercel = await import("/Users/gabriel/pi/packages/ai/dist/providers/data/vercel-ai-gateway.json", { with: { type: "json" } });
log("after the vercel model data");
const models = await import("/Users/gabriel/pi/packages/ai/dist/models.generated.js");
log("after every provider model list");
console.log("models:", Object.keys(models).length, "openrouter entries:", Object.keys(data.default ?? data).length, "bedrock:", Object.keys(bedrock.default ?? bedrock).length, "vercel:", Object.keys(vercel.default ?? vercel).length);
