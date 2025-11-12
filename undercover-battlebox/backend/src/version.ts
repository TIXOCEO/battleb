// src/version.ts
// ✅ Compatibel met CommonJS én ESM builds

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json");

export const BATTLEBOX_VERSION: string = pkg.version || "dev";
