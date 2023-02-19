<h1 align="center">streaming-multipart</h1>

<p align="center">
  A streaming multipart reader and writer for Web-compatible JavaScript runtimes with zero dependencies.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/streaming-multipart">
    <img src="https://img.shields.io/npm/v/async-cell?style=for-the-badge" alt="downloads" height="24">
  </a>
  <a href="https://www.npmjs.com/package/streaming-multipart">
    <img src="https://img.shields.io/github/actions/workflow/status/zebp/async-cell/ci.yml?branch=main&style=for-the-badge" alt="npm version" height="24">
  </a>
  <a href="https://github.com/zebp/streaming-multipart">
    <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT license" height="24">
  </a>
</p>

```ts
import { MultipartReader } from "streaming-multipart";

const form = new FormData();
form.append("foo", "bar");
form.append(
  "file",
  new Blob(["hello world"], { type: "text/plain" }),
  "file.txt",
);

const reader = new MultipartReader(
  new Request("https://example.com", {
    method: "POST",
    body: form,
  }),
);

for await (const part of reader) {
  const body = await part.arrayBuffer();
  console.log(part.name, part.fileName, part.headers, body);
}
```

## Features

- Streaming support
- Supports Node.js, Deno, Cloudflare Workers, and other Web-compatible
  JavaScript runtimes
- Zero dependencies

## Requirements

- A Web-compatible JavaScript runtime (Node.js, Deno, Bun, Cloudflare Workers,
  etc.)

## Installation

Via npm:

```sh
npm install streaming-multipart
```

Via yarn:

```sh
yarn add streaming-multipart
```

Via pnpm:

```sh
pnpm add streaming-multipart
```

Via deno:

```ts
import { MultipartReader } from "https://deno.land/x/streaming_multipart/mod.ts";
```
