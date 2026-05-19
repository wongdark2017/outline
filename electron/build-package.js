/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "build/electron");
const assetsDir = path.join(outputDir, "assets");
const sourceIcon = path.join(rootDir, "public/images/Icon-1024.png");
const outputIcon = path.join(assetsDir, "icon.png");
const rootPackage = require(path.join(rootDir, "package.json"));
const builderConfig = path.join(rootDir, "electron/electron-builder.json");

const desktopPackage = {
  name: "outline-desktop",
  productName: "Outline",
  version: rootPackage.version,
  description: "Outline desktop app",
  license: rootPackage.license,
  main: "main.js",
};

fs.mkdirSync(assetsDir, { recursive: true });
fs.copyFileSync(sourceIcon, outputIcon);
fs.copyFileSync(builderConfig, path.join(outputDir, "electron-builder.json"));
fs.writeFileSync(
  path.join(outputDir, "package.json"),
  `${JSON.stringify(desktopPackage, null, 2)}\n`
);
fs.writeFileSync(path.join(outputDir, "yarn.lock"), "");

console.log("Prepared Electron package metadata.");
