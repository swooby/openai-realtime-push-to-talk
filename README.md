# OpenAI Realtime Console Push-To-Talk (PTT)

**NOTE: This fork was created on 2025/02/07 and is a work in progress for a Push-To-Talk specific demo/test interface to the OpenAI Realtime API.**

This is an example application showing how to use the [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) with [WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc).

## Installation and usage

Before you begin, you'll need an OpenAI API key - [create one in the dashboard here](https://platform.openai.com/settings/api-keys). Create a `.env` file from the example file and set your API key in there:

```bash
cp .env.example .env
```

Running this application locally requires [Node.js](https://nodejs.org/) to be installed. Install dependencies for the application with:

```bash
npm install
```

Start the application server with:

```bash
npm run dev
```

This should start the console application on [http://localhost:3000](http://localhost:3000).

_Note:_ The `server.js` file uses [@fastify/vite](https://fastify-vite.dev/) to build and serve the React frontend contained in the [`/client`](./client) folder. You can find the configuration in the [`vite.config.js`](./vite.config.js) file.

## Previous WebSockets version

The previous version of this application that used WebSockets on the client (not recommended in client-side browsers) [can be found here](https://github.com/openai/openai-realtime-console/tree/websockets).

## License

MIT
