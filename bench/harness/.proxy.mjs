import { createServer, request as httpRequest } from "node:http";

const upstream = new URL("http://127.0.0.1:8081");
const port = 8090;

const server = createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const body = Buffer.concat(chunks);
		process.stderr.write(`--- ${request.method} ${request.url} (${body.length} bytes)\n`);
		process.stderr.write(`${body.toString("utf8").slice(0, 3000)}\n`);
		const target = new URL(request.url ?? "/", upstream);
		const upstreamRequest = httpRequest(
			{
				method: request.method,
				hostname: target.hostname,
				port: target.port,
				path: target.pathname + target.search,
				headers: { ...request.headers, host: target.host },
			},
			(upstreamResponse) => {
				response.writeHead(upstreamResponse.statusCode ?? 500, upstreamResponse.headers);
				upstreamResponse.pipe(response);
			},
		);
		upstreamRequest.end(body);
	});
}).listen(port, "127.0.0.1", () => {
	process.stderr.write(`proxy on ${port}\n`);
});

server.on("clientError", (error, socket) => {
	process.stderr.write(`--- client error: ${error.message}\n`);
	socket.destroy();
});
