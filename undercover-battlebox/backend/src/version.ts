// src/version.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export const BATTLEBOX_VERSION = version;
