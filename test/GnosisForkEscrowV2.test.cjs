const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");

const describeFork = process.env.GNOSIS_FORK_RPC_URL ? describe : describe.skip;

describeFork("FundedProjectEscrowV2 on a Gnosis fork", function () {
  const HUB = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
  const DEPLOYED_REGISTRY = "0x73660aAAB3454A2583e73B8A0Ae26d9d88A86352";
  const V1_ESCROW = "0x16117dd001A9f57347768365fFc0c90084eaa7E5";
  const GNOSIS_APP_OWNER = "0x2DD131AAfdD8f0B95f480904A52C3e8334640496";
  const TOKEN_ID = 1403327820859745496727682770651937862229618430510n;
  const CRC = 10n ** 18n;

  const hubAbi = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)"
  ];

  it("receives and withdraws real CRC through the deployed Circles Hub", async function () {
    const [deployer] = await ethers.getSigners();
    const hub = new ethers.Contract(HUB, hubAbi, deployer);
    const available = await hub.balanceOf(V1_ESCROW, TOKEN_ID);
    assert.ok(available >= 5n * CRC, "The selected mainnet CRC balance is no longer sufficient");

    const Registry = await ethers.getContractFactory("FundedProjectEscrowV2");
    const registry = await Registry.deploy(HUB);
    const latest = await ethers.provider.getBlock("latest");
    const projectId = ethers.keccak256(ethers.toUtf8Bytes("gnosis-fork-project"));
    const deadline = BigInt(latest.timestamp + 14 * 24 * 60 * 60);
    for (const address of [GNOSIS_APP_OWNER, V1_ESCROW]) {
      await network.provider.request({
        method: "hardhat_setBalance",
        params: [address, "0x56BC75E2D63100000"]
      });
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [address]
      });
    }

    const owner = await ethers.getSigner(GNOSIS_APP_OWNER);
    await registry.connect(owner).createProject(projectId, 5n * CRC, deadline, "fork:test");
    const project = await registry.getProject(projectId);
    const vault = await ethers.getContractAt("FundedProjectVaultV2", project.vault);

    const escrowSigner = await ethers.getSigner(V1_ESCROW);
    const hubAsEscrow = hub.connect(escrowSigner);
    await hubAsEscrow.safeTransferFrom(V1_ESCROW, project.vault, TOKEN_ID, 5n * CRC, "0x");

    assert.equal(await vault.raised(), 5n * CRC);
    assert.equal(await hub.balanceOf(project.vault, TOKEN_ID), 5n * CRC);

    const ownerBalanceBefore = await hub.balanceOf(GNOSIS_APP_OWNER, TOKEN_ID);
    await vault.connect(owner).withdraw("Fork withdrawal");
    const ownerBalanceAfter = await hub.balanceOf(GNOSIS_APP_OWNER, TOKEN_ID);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, 5n * CRC);
    assert.equal(await hub.balanceOf(project.vault, TOKEN_ID), 0n);

    for (const address of [GNOSIS_APP_OWNER, V1_ESCROW]) {
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [address]
      });
    }
  });

  it("creates, funds, and withdraws through the Remix-deployed V2 registry", async function () {
    const [deployer] = await ethers.getSigners();
    const hub = new ethers.Contract(HUB, hubAbi, deployer);
    const registry = await ethers.getContractAt("FundedProjectEscrowV2", DEPLOYED_REGISTRY);
    const latest = await ethers.provider.getBlock("latest");
    const projectId = ethers.keccak256(ethers.toUtf8Bytes(`deployed-v2-fork-${latest.number}`));
    const deadline = BigInt(latest.timestamp + 14 * 24 * 60 * 60);

    for (const address of [GNOSIS_APP_OWNER, V1_ESCROW]) {
      await network.provider.request({ method: "hardhat_setBalance", params: [address, "0x56BC75E2D63100000"] });
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
    }

    const owner = await ethers.getSigner(GNOSIS_APP_OWNER);
    await registry.connect(owner).createProject(projectId, 5n * CRC, deadline, "fork:deployed-v2");
    const project = await registry.getProject(projectId);
    const vault = await ethers.getContractAt("FundedProjectVaultV2", project.vault);
    const escrowSigner = await ethers.getSigner(V1_ESCROW);
    await hub.connect(escrowSigner).safeTransferFrom(V1_ESCROW, project.vault, TOKEN_ID, 5n * CRC, "0x");
    await vault.connect(owner).withdraw("Deployed V2 fork withdrawal");

    assert.equal(await vault.withdrawn(), true);
    assert.equal(await hub.balanceOf(project.vault, TOKEN_ID), 0n);
  });
});
