import { build, emptyDir } from "https://deno.land/x/dnt@0.33.1/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  package: {
    // package.json properties
    name: "streaming-multipart",
    version: Deno.args[0],
    description:
      "A streaming multipart reader and writer for Web-compatible JavaScript runtimes with zero dependencies.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/zebp/streaming-multipart.git",
    },
    bugs: {
      url: "https://github.com/zebp/streaming-multipart/issues",
    },
  },
  compilerOptions: {
    target: "ES2021",
    lib: ["es2021", "dom"],
  },
  esModule: true,
});

// post build steps
Deno.copyFileSync("README.md", "npm/README.md");
