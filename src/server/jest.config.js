const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  testMatch: [
    "**/src/**/*.test.ts",
    "!**/dist/**",
    "!**/node_modules/**",
  ],
  // Run Docker tests serially to avoid race conditions
  testTimeout: 300000, // 5 minutes for Docker builds
};