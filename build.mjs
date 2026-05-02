import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  legalComments: "none",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js" }),
  build({ ...common, entryPoints: ["src/hook-session-start.ts"], outfile: "dist/hook-session-start.js" }),
]);

console.log("Built dist/index.js and dist/hook-session-start.js");
