require("@nomicfoundation/hardhat-ethers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }, runSuper) => {
  if (solcVersion !== "0.8.35") return runSuper();
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: solcVersion,
    longVersion: require("solc").version()
  };
});

module.exports = {
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./.hardhat-cache",
    artifacts: "./artifacts"
  },
  networks: {
    hardhat: process.env.GNOSIS_FORK_RPC_URL
      ? {
          forking: { url: process.env.GNOSIS_FORK_RPC_URL },
          chains: {
            100: { hardforkHistory: { cancun: 0 } }
          }
        }
      : {}
  }
};
