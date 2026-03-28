import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", network.name);

  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  console.log("AgentRegistry:", await registry.getAddress());

  const AIContextManager = await ethers.getContractFactory("AIContextManager");
  const contextManager = await AIContextManager.deploy();
  await contextManager.waitForDeployment();
  console.log("AIContextManager:", await contextManager.getAddress());

  const AIMemoryStore = await ethers.getContractFactory("AIMemoryStore");
  const memoryStore = await AIMemoryStore.deploy();
  await memoryStore.waitForDeployment();
  console.log("AIMemoryStore:", await memoryStore.getAddress());

  const deployment = {
    network: network.name,
    chainId: network.config.chainId,
    AgentRegistry: await registry.getAddress(),
    AIContextManager: await contextManager.getAddress(),
    AIMemoryStore: await memoryStore.getAddress(),
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const filename = network.name === "arbitrumSepolia" ? "arbitrum-sepolia.json" : `${network.name}.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(deployment, null, 2));
  console.log(`Deployment saved to deployments/${filename}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
