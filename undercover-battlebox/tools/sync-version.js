import fs from "fs";
const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const version = pkg.version;
fs.writeFileSync("./frontend/.env.local", `NEXT_PUBLIC_BATTLEBOX_VERSION=${version}\n`);
console.log(`✅ Synced version ${version} to frontend .env.local`);
