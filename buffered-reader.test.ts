import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { BufferedReadableStreamReader } from "./buffered-reader.ts";

Deno.test("read exact single chunk", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());

  // Read 4 bytes and ensure we get the first 4 bytes.
  let result = await reader.readExact(4);
  assertFalse(result.done);
  assertExists(result.value);
  assert(result.value.length === 4);
  assertEquals(result.value, new Uint8Array([1, 2, 3, 4]));

  // Read a chunk, ensure that we get the remaining 4 bytes.
  result = await reader.read();
  assertFalse(result.done);
  assertExists(result.value);
  assert(result.value.length === 4);
  assertEquals(result.value, new Uint8Array([5, 6, 7, 8]));

  // Read again, ensure that we get nothing.
  result = await reader.read();
  assert(result.done);
});

Deno.test("read exact multiple chunks", async () => {
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulls === 2) {
        controller.close();
        return;
      }

      const bytes = [1, 2, 3, 4].map((n) => n + (pulls * 4));
      const data = new Uint8Array(bytes);
      controller.enqueue(data);
      pulls++;
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());

  // Read 4 bytes and ensure we get the first 4 bytes.
  let result = await reader.readExact(4);
  assertFalse(result.done);
  assertExists(result.value);
  assert(result.value.length === 4);
  assertEquals(result.value, new Uint8Array([1, 2, 3, 4]));

  // Read a chunk, ensure that we get the remaining 4 bytes.
  result = await reader.read();
  assertFalse(result.done);
  assertExists(result.value);
  assert(result.value.length === 4);
  assertEquals(result.value, new Uint8Array([5, 6, 7, 8]));

  // Read again, ensure that we get nothing.
  result = await reader.read();
  assert(result.done);
});

Deno.test("not enough bytes throws", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());

  await assertRejects(async () => {
    await reader.readExact(16);
  });
});

Deno.test("read until single byte single chunk", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());
  const result = await reader.readUntil(new Uint8Array([4]), {
    includeDelimiter: true,
    output: "bytes",
  });

  assertFalse(result.done);
  assertExists(result.value);
  assert(result.value.length === 4);
  assertEquals(result.value, new Uint8Array([1, 2, 3, 4]));
});

Deno.test("read until stream single chunk", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      const data = new Uint8Array([1, 2, 3, 4]);
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());
  const iterator = reader.readUntil(new Uint8Array([4]), {
    includeDelimiter: true,
    output: "stream",
  });

  const value = await iterator.next();
  assertFalse(value.done);
  assertExists(value.value);
  assert(value.value.length === 4);
  assertEquals(value.value, new Uint8Array([1, 2, 3, 4]));
});

Deno.test("read until stream two chunk", async () => {
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulls === 2) {
        controller.close();
        return;
      }

      const bytes = [1, 2, 3, 4].map((n) => n + (pulls * 4));
      const data = new Uint8Array(bytes);
      controller.enqueue(data);
      pulls++;
    },
  });

  const reader = new BufferedReadableStreamReader(stream.getReader());
  const iterable = reader.readUntil(new Uint8Array([6, 7]), {
    output: "stream",
    includeDelimiter: false,
  });

  let result = await iterable.next();
  assertFalse(result.done);
  let buffer = result.value as Uint8Array;
  assertExists(buffer);
  assert(buffer.length === 4);
  assertEquals(buffer, new Uint8Array([1, 2, 3, 4]));

  result = await iterable.next();
  assertFalse(result.done);
  buffer = result.value as Uint8Array;
  assertExists(buffer);
  assert(buffer.length === 1);
  assertEquals(buffer, new Uint8Array([5]));

  result = await iterable.next();
  assert(result.done);

  // Read again, ensure that we get everything after the delimiter.
  const afterResult = await reader.read();
  assertFalse(afterResult.done);
  assertExists(afterResult.value);
  assert(afterResult.value.length === 1);
  assertEquals(afterResult.value, new Uint8Array([8]));
});
