import {
  assertEquals,
  assertExists,
  fail,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { MultipartReader } from "./mod.ts";

Deno.test("from file", async () => {
  const [boundary, data] = await testForm();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new MultipartReader(
    stream,
    boundary,
  );

  let part = await reader.readPart() ?? fail("part is missing");
  assertEquals(part.name, "field1");
  assertEquals(await part.text(), "example");

  part = await reader.readPart() ?? fail("part is missing");
  assertEquals(part.name, "file1");
  assertExists(part.fileName);
  assertEquals(part.fileName, "file.bin");
  assertEquals(
    await part.arrayBuffer(),
    new Uint8Array([
      0xf9,
      0xdf,
      0x35,
      0xb8,
      0xa8,
      0x70,
      0x5e,
      0x54,
    ]),
  );

  const noPart = await reader.readPart();
  assertEquals(noPart, undefined);
});

Deno.test("from file with tiny chunks", async () => {
  let [boundary, data] = await testForm();
  const stream = new ReadableStream({
    pull(controller) {
      if (data.length > 0) {
        const chunk = data.slice(0, 1);
        data = data.slice(1);
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });

  const reader = new MultipartReader(
    stream,
    boundary,
  );

  let part = await reader.readPart() ?? fail("part is missing");
  assertEquals(part.name, "field1");
  assertEquals(await part.text(), "example");

  part = await reader.readPart() ?? fail("part is missing");
  assertEquals(part.name, "file1");
  assertExists(part.fileName);
  assertEquals(part.fileName, "file.bin");
  assertEquals(
    await part.arrayBuffer(),
    new Uint8Array([
      0xf9,
      0xdf,
      0x35,
      0xb8,
      0xa8,
      0x70,
      0x5e,
      0x54,
    ]),
  );

  const noPart = await reader.readPart();
  assertEquals(noPart, undefined);
});

Deno.test("using async iterator", async () => {
  const [boundary, data] = await testForm();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const reader = new MultipartReader(
    stream,
    boundary,
  );

  const parts: Record<string, Uint8Array> = {
    field1: new TextEncoder().encode("example"),
    file1: new Uint8Array([
      0xf9,
      0xdf,
      0x35,
      0xb8,
      0xa8,
      0x70,
      0x5e,
      0x54,
    ]),
  };

  for await (const part of reader) {
    const explicitlyStreamedBytes = await new Response(part.body).arrayBuffer();
    assertEquals(
      new Uint8Array(explicitlyStreamedBytes),
      parts[part.name],
    );
  }
});

async function testForm(): Promise<[string, Uint8Array]> {
  const form = new FormData();
  form.append("field1", "example");
  form.append(
    "file1",
    new Blob(
      [
        new Uint8Array([
          0xf9,
          0xdf,
          0x35,
          0xb8,
          0xa8,
          0x70,
          0x5e,
          0x54,
        ]),
      ],
      { type: "application/octet-stream" },
    ),
    "file.bin",
  );

  const request = new Request("https://example.com", {
    method: "POST",
    body: form,
  });
  const body = await request.arrayBuffer();

  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw new Error("Missing content-type header");
  }

  if (!contentType.startsWith("multipart/form-data")) {
    throw new Error("Expected multipart/form-data");
  }

  let boundary = contentType.split("boundary=")[1];
  if (!boundary) {
    throw new Error("Missing boundary");
  }

  if (boundary.startsWith('"') && boundary.endsWith('"')) {
    boundary = boundary.slice(1, -1);
  }

  return [boundary, new Uint8Array(body)];
}
