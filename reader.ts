import { BufferedReadableStreamReader } from "./buffered-reader.ts";
import { bytesEqual, concat } from "./util.ts";

const NEW_LINE = new Uint8Array([13, 10]);
const DOUBLE_NEW_LINE = new Uint8Array([13, 10, 13, 10]);
const DOUBLE_DASH = new Uint8Array([45, 45]);

export interface FormPart {
  readonly name: string;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly headers: Headers;

  arrayBuffer(): Promise<Uint8Array>;

  text(): Promise<string>;

  json(): Promise<unknown>;

  /**
   * Skip the FormPart so subsequent calls to [MultipartReader.readPart] will proceed to the next
   * part.
   */
  skip(): Promise<void>;
}

class FormPartImpl implements FormPart {
  readonly name: string = "test";
  readonly fileName?: string;
  readonly headers: Headers;

  readonly #chunks: AsyncIterator<Uint8Array>;
  readonly #reader: BufferedReadableStreamReader;

  constructor(
    chunks: AsyncIterator<Uint8Array>,
    reader: BufferedReadableStreamReader,
    headers: Headers,
  ) {
    this.#chunks = chunks;
    this.#reader = reader;
    this.headers = headers;

    const contentDisposition = headers.get("content-disposition");
    if (!contentDisposition) {
      throw new Error("Missing content-disposition header");
    }

    const { name, filename } = parseContentDisposition(contentDisposition);
    this.name = name;
    this.fileName = filename;
  }

  get body(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      pull: async (controller) => {
        const { value, done } = await this.#chunks.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      cancel: () => this.#reader.cancel(),
    });
  }

  async arrayBuffer(): Promise<Uint8Array> {
    let buf = new Uint8Array();
    while (true) {
      const { value, done } = await this.#chunks.next();
      if (done) {
        break;
      }
      buf = concat(buf, value);
    }
    return buf;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  async skip(): Promise<void> {
    while (true) {
      const { done } = await this.#chunks.next();
      if (done) {
        break;
      }
    }
  }

  get contentType(): string | undefined {
    return this.headers.get("content-type") ?? undefined;
  }
}

export class MultipartReader {
  readonly boundary: string;
  readonly #boundaryBytes: Uint8Array;
  readonly #prefixedBoundaryBytes: Uint8Array;

  readonly #reader: BufferedReadableStreamReader;

  constructor(request: Request);
  constructor(stream: ReadableStream<Uint8Array>, boundary: string);
  constructor(
    requestOrStream: ReadableStream<Uint8Array> | Request,
    boundary?: string,
  ) {
    if (requestOrStream instanceof Request) {
      const request = requestOrStream;
      const contentType = request.headers.get("content-type");
      if (!contentType) {
        throw new Error("Missing content-type header");
      }

      if (!contentType.startsWith("multipart/form-data")) {
        throw new Error("Expected multipart/form-data");
      }

      this.boundary = contentType.split("boundary=")[1];
      if (!this.boundary) {
        throw new Error("Missing boundary");
      }

      if (this.boundary.startsWith('"') && this.boundary.endsWith('"')) {
        this.boundary = this.boundary.slice(1, -1);
      }

      if (request.body == null) {
        throw new Error("Missing request body");
      }

      if (request.bodyUsed) {
        throw new Error("Request body already used");
      }

      this.#reader = new BufferedReadableStreamReader(
        request.body.getReader(),
      );
    } else {
      this.boundary = boundary!;
      this.#reader = new BufferedReadableStreamReader(
        requestOrStream.getReader(),
      );
    }

    this.#boundaryBytes = new TextEncoder().encode(this.boundary);
    this.#prefixedBoundaryBytes = concat(DOUBLE_DASH, this.#boundaryBytes);
  }

  async readPart(): Promise<FormPart | undefined> {
    const result = await this.#reader.readExact(2);
    if (result.done) {
      throw new Error("Unexpected end of stream");
    }

    if (bytesEqual(result.value, DOUBLE_DASH)) {
      // We might have reached the end of the stream, or we're about to read the boundary again.
      const peeked = await this.#reader.peek(2);

      if (peeked === undefined) {
        return undefined;
      } else if (bytesEqual(peeked, NEW_LINE)) {
        // We're at the end of the stream.
        return undefined;
      }

      await assertRead(this.#reader, this.#boundaryBytes);
      await assertRead(this.#reader, NEW_LINE);
    } else if (!bytesEqual(result.value, NEW_LINE)) {
      throw new Error("Expected newline");
    }

    const headerBytes = await tryReadUntil(this.#reader, DOUBLE_NEW_LINE);
    const headers = parseHeaders(new TextDecoder().decode(headerBytes));

    const iterator = this.#reader.readUntil(
      concat(NEW_LINE, this.#prefixedBoundaryBytes),
      {
        includeDelimiter: false,
        output: "stream",
      },
    );

    return new FormPartImpl(iterator, this.#reader, headers);
  }

  [Symbol.asyncIterator](): AsyncIterator<FormPart> {
    return {
      next: async () => {
        const part = await this.readPart();
        if (part) {
          return { value: part, done: false };
        } else {
          return { done: true, value: undefined };
        }
      },
    };
  }
}

async function assertRead(
  reader: BufferedReadableStreamReader,
  expected: Uint8Array,
) {
  const result = await reader.readExact(expected.length);
  if (result.done) {
    throw new Error("Unexpected end of stream");
  }
  if (!bytesEqual(result.value, expected)) {
    const expectedStr = new TextDecoder().decode(expected);
    const resultStr = new TextDecoder().decode(result.value);
    throw new Error(`Expected "${expectedStr}", got "${resultStr}"`);
  }
}

async function tryReadUntil(
  reader: BufferedReadableStreamReader,
  pattern: Uint8Array,
  inclusive = false,
): Promise<Uint8Array> {
  const result = await reader.readUntil(pattern, {
    includeDelimiter: inclusive,
    output: "bytes",
  });
  if (result.done) {
    throw new Error("Unexpected end of stream");
  }

  return result.value;
}

function parseHeaders(rawHeaders: string): Headers {
  const headers = new Headers();
  const lines = rawHeaders.split("\r\n");
  for (const line of lines) {
    const [key, value] = line.split(":");
    headers.set(key, value);
  }

  return headers;
}

function parseContentDisposition(
  contentDisposition: string,
): { name: string; filename?: string } {
  const params = new Map<string, string>();
  const parts = contentDisposition.split(";").map((s) => s.trim());
  for (const part of parts.slice(1)) {
    const [key, value] = part.split("=");
    params.set(key, value);
  }

  let name = params.get("name");
  if (!name) {
    throw new Error("Missing name");
  }
  name = name.replace(/^"(.*)"$/, "$1");

  let filename = params.get("filename");
  if (filename) {
    filename = filename.replace(/^"(.*)"$/, "$1");
  }

  return { name, filename };
}
