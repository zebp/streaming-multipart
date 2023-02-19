import { bytesEqual, concat } from "./util.ts";

// TODO(zebp): fix this DNT hack
type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader["read"]>>;

interface BaseReadUntilOptions {
  includeDelimiter: boolean;
}

type ReadUntilOptionsBytesOutput = BaseReadUntilOptions & { output: "bytes" };
type ReadUntilOptionsStreamOutput = BaseReadUntilOptions & { output: "stream" };

export type ReadUntilOptions =
  | ReadUntilOptionsBytesOutput
  | ReadUntilOptionsStreamOutput;

export class BufferedReadableStreamReader
  implements ReadableStreamDefaultReader<Uint8Array> {
  #inner: ReadableStreamDefaultReader;
  #buffer: Uint8Array | undefined;

  #hasClosed = false;
  #close: ((value: undefined) => void) | undefined;
  closed: Promise<undefined>;

  constructor(inner: ReadableStreamDefaultReader) {
    this.#inner = inner;
    inner.closed.then(() => {
      this.#hasClosed = true;
    });

    this.closed = new Promise<undefined>((resolve) => {
      this.#close = resolve;
    });
  }

  read(): Promise<ReadResult> {
    if (this.#buffer) {
      const buf = this.#buffer;
      this.#buffer = undefined;
      return Promise.resolve({ value: buf, done: false });
    }

    // The inner stream might have closed but we still had data in our buffer, so we should return
    // it on the next call to read and then when they go to check again we'll have closed.
    if (this.#hasClosed) {
      // Resolve the close promise.
      (this.#close!)(undefined);
    }

    return this.#inner.read();
  }
  async peek(length?: number): Promise<Uint8Array | undefined> {
    if (length === undefined) {
      if (this.#buffer) {
        return this.#buffer;
      }

      const result = await this.read();
      if (result.done) {
        return undefined;
      }

      this.#buffer = result.value;
      return result.value;
    } else {
      if (this.#buffer) {
        return this.#buffer.slice(0, length);
      }

      let bytesRead = 0;
      let buf = new Uint8Array();

      while (bytesRead < length) {
        const result = await this.read();
        if (result.done) {
          this.#buffer = buf;
          return undefined;
        }

        buf = concat(buf, result.value);
        bytesRead += result.value.length;
      }

      // If we read more than we needed, put the extra bytes back into the buffer
      // so they can be read later.
      if (bytesRead > length) {
        this.#buffer = buf.slice(length);
        buf = buf.slice(0, length);
      }

      this.#buffer = buf;
      return buf;
    }
  }

  async readExact(
    length: number,
  ): Promise<ReadResult> {
    let bytesRead = 0;
    let buf = new Uint8Array();

    while (bytesRead < length) {
      const result = await this.read();
      if (result.done) {
        throw new Error(
          `Not enough bytes to read. Expected ${length}, got ${bytesRead}`,
        );
      }

      buf = concat(buf, result.value);
      bytesRead += result.value.length;
    }

    // If we read more than we needed, put the extra bytes back into the buffer
    // so they can be read later.
    if (bytesRead > length) {
      this.#buffer = buf.slice(length);
      buf = buf.slice(0, length);
    }

    return { value: buf, done: false };
  }

  async *#readUntilInternal(
    delimiter: Uint8Array,
    inclusive = false,
  ): AsyncIterableIterator<Uint8Array> {
    // If we have a partial match in our buffer, we need to keep track of how many bytes we've
    // matched so far so we can skip them when we read the next chunk.
    let bytesIntoDelimiter = 0;

    while (true) {
      const remainingDelimiter = delimiter.slice(bytesIntoDelimiter);
      const result = await this.read();
      if (result.done) {
        return;
      }

      const chunk = result.value;

      // Check if the whole chunk is part of the remaining delimiter, if so skip it.
      if (isChunkPartOfDelimiter(chunk, remainingDelimiter)) {
        bytesIntoDelimiter += chunk.length;

        if (bytesIntoDelimiter == delimiter.length) {
          if (inclusive) {
            yield delimiter;
          }
          return;
        }

        continue;
      }

      // If the chunk contains the end of the delimiter, we need to split the chunk and put the
      // remaining bytes back into the buffer.
      if (
        remainingDelimiter.length > chunk.length &&
        bytesEqual(
          remainingDelimiter,
          chunk.slice(0, remainingDelimiter.length),
        )
      ) {
        this.#buffer = chunk.slice(
          0,
          chunk.length - remainingDelimiter.length,
        );

        if (inclusive) {
          yield delimiter;
        }

        continue;
      }

      // If the chunk contains the start of the delimiter, we split the chunk at the start of the
      // delimiter and yield the first part.
      const partialMatch = indexOfPartialMatch(chunk, remainingDelimiter);
      if (partialMatch !== undefined) {
        const [index, matchingBytes] = partialMatch;

        if (index > 0) {
          if (inclusive) {
            yield chunk.slice(0, index + matchingBytes);
          } else {
            yield chunk.slice(0, index);
          }
        }

        // If the delimiter is completely contained in the chunk, we need to put the remaining
        // bytes back into the buffer.
        if (bytesIntoDelimiter + matchingBytes == delimiter.length) {
          this.#buffer = chunk.slice(index + matchingBytes);
          return;
        } else {
          bytesIntoDelimiter += matchingBytes;
          continue;
        }
      }

      // If none of the above conditions are met, then we need to reset the bytesIntoDelimiter
      // and yield however much of the delimiter we've matched so far.
      if (bytesIntoDelimiter > 0) {
        yield delimiter.slice(0, bytesIntoDelimiter);
      }

      bytesIntoDelimiter = 0;

      yield chunk;
    }
  }

  async readUntil(
    delimiter: Uint8Array,
    options: ReadUntilOptionsBytesOutput,
  ): Promise<ReadResult>;
  readUntil(
    delimiter: Uint8Array,
    options: ReadUntilOptionsStreamOutput,
  ): AsyncIterator<Uint8Array>;
  readUntil(delimiter: Uint8Array, options: ReadUntilOptions = {
    includeDelimiter: false,
    output: "bytes",
  }): Promise<ReadResult> | AsyncIterator<Uint8Array> {
    if (options.output === "bytes") {
      return (async () => {
        let buf = new Uint8Array();

        for await (
          const chunk of this.#readUntilInternal(
            delimiter,
            options.includeDelimiter,
          )
        ) {
          buf = concat(buf, chunk);
        }

        return { value: buf, done: false };
      })();
    } else {
      return this.#readUntilInternal(
        delimiter,
        options.includeDelimiter,
      );
    }
  }

  releaseLock(): void {
    this.#inner.releaseLock();
  }

  // deno-lint-ignore no-explicit-any
  cancel(reason?: any): Promise<void> {
    return this.#inner.cancel(reason);
  }
}

function isChunkPartOfDelimiter(
  chunk: Uint8Array,
  delimiter: Uint8Array,
): boolean {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== delimiter[i]) {
      return false;
    }
  }
  return true;
}

// a function that finds the index of the first partial match of the delimiter
// in the bytes. If there is no partial match, it returns undefined.
function indexOfPartialMatch(
  bytes: Uint8Array,
  delimiter: Uint8Array,
): [number, number] | undefined {
  let matchedSoFar = 0;
  for (let i = 0; i < bytes.length; i++) {
    let match = true;
    for (let j = 0; j < delimiter.length; j++) {
      matchedSoFar = j + 1;
      if (i + j < bytes.length && bytes[i + j] !== delimiter[j]) {
        match = false;
        matchedSoFar = 0;
        break;
      }
    }
    if (match) {
      return [i, matchedSoFar];
    }
  }
  return undefined;
}
