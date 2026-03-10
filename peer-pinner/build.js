const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["peer-pinner.js"],
  outfile: "dist/peer-pinner.js",
  bundle: true,
  minify: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  legalComments: "none"
}).catch(() => process.exit(1));
