import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    arbitrumSepolia: {
      url: process.env.RPC_URL_ARBITRUM_SEPOLIA ?? "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 421614,
    },
    arbitrum: {
      url: process.env.RPC_URL_ARBITRUM ?? "https://arb1.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 42161,
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? "",
      arbitrumOne: process.env.ARBISCAN_API_KEY ?? "",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts",
  },
};

export default config;
