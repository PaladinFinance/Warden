module.exports = {
  norpc: true,
  testCommand: "npm run test",
  compileCommand: "npm run compile",
  skipFiles: [
    'interfaces/',
    'open-zeppelin/',
    'WardenLens.sol'
  ],
  mocha: {
    fgrep: "[skip-on-coverage]",
    invert: true,
  },
};