const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");
const { CirclesConverter } = require("@aboutcircles/sdk-utils");

const describeFork = process.env.GNOSIS_FORK_RPC_URL ? describe : describe.skip;

describeFork("FundedProjectEscrowV2 on a Gnosis fork", function () {
  const HUB = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
  const DEPLOYED_REGISTRY = "0x73660aAAB3454A2583e73B8A0Ae26d9d88A86352";
  const V1_ESCROW = "0x16117dd001A9f57347768365fFc0c90084eaa7E5";
  const GNOSIS_APP_OWNER = "0x2DD131AAfdD8f0B95f480904A52C3e8334640496";
  const OWNER_DEMURRAGE_WRAPPER = "0x9741C2EA571A4c1DCD9BB8C290E27cEb93560C67";
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

  it("uses CRC-converted raw Circles amounts with the deployed V2 registry", async function () {
    const [deployer] = await ethers.getSigners();
    const hub = new ethers.Contract(HUB, hubAbi, deployer);
    const registry = await ethers.getContractAt("FundedProjectEscrowV2", DEPLOYED_REGISTRY);
    const latest = await ethers.provider.getBlock("latest");
    const projectId = ethers.keccak256(ethers.toUtf8Bytes(`crc-units-fork-${latest.number}`));
    const deadline = BigInt(latest.timestamp + 14 * 24 * 60 * 60);
    const goalCrc = 10n * CRC;
    const rawGoal = CirclesConverter.attoCrcToAttoCircles(goalCrc, BigInt(latest.timestamp));
    const firstRaw = CirclesConverter.attoCrcToAttoCircles(5n * CRC, BigInt(latest.timestamp));
    const secondRaw = rawGoal - firstRaw;
    const secondTokenId = 1025331437817491135040385225856981609024734138216n;

    for (const address of [GNOSIS_APP_OWNER, V1_ESCROW]) {
      await network.provider.request({ method: "hardhat_setBalance", params: [address, "0x56BC75E2D63100000"] });
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
    }

    const owner = await ethers.getSigner(GNOSIS_APP_OWNER);
    await registry.connect(owner).createProject(projectId, rawGoal, deadline, "fork:crc-units");
    const project = await registry.getProject(projectId);
    const vault = await ethers.getContractAt("FundedProjectVaultV2", project.vault);
    const hubAsEscrow = hub.connect(await ethers.getSigner(V1_ESCROW));
    await hubAsEscrow.safeTransferFrom(V1_ESCROW, project.vault, secondTokenId, firstRaw, "0x");
    await hubAsEscrow.safeTransferFrom(V1_ESCROW, project.vault, secondTokenId, secondRaw, "0x");

    assert.equal(await vault.raised(), rawGoal);
    const rawPerCrc = CirclesConverter.attoCrcToAttoCircles(CRC, BigInt(latest.timestamp));
    const recoveredCrc = (await vault.raised()) * CRC / rawPerCrc;
    assert.ok(recoveredCrc >= goalCrc - 10n && recoveredCrc <= goalCrc + 10n);
    await vault.connect(owner).withdraw("CRC unit conversion fork test");
    assert.equal(await vault.withdrawn(), true);
  });

  it("unwraps CRC, funds a converted V2 goal, and returns the full raw balance", async function () {
    const [deployer] = await ethers.getSigners();
    const hub = new ethers.Contract(HUB, hubAbi, deployer);
    const registry = await ethers.getContractAt("FundedProjectEscrowV2", DEPLOYED_REGISTRY);
    const latest = await ethers.provider.getBlock("latest");
    const projectId = ethers.keccak256(ethers.toUtf8Bytes(`crc-unwrap-fork-${latest.number}`));
    const deadline = BigInt(latest.timestamp + 14 * 24 * 60 * 60);
    const rawGoal = CirclesConverter.attoCrcToAttoCircles(10n * CRC, BigInt(latest.timestamp));

    await network.provider.request({ method: "hardhat_setBalance", params: [GNOSIS_APP_OWNER, "0x56BC75E2D63100000"] });
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [GNOSIS_APP_OWNER] });
    const owner = await ethers.getSigner(GNOSIS_APP_OWNER);
    const wrapper = new ethers.Contract(OWNER_DEMURRAGE_WRAPPER, ["function balanceOf(address) view returns(uint256)", "function unwrap(uint256)"], owner);
    assert.ok(await wrapper.balanceOf(GNOSIS_APP_OWNER) >= rawGoal);

    await registry.connect(owner).createProject(projectId, rawGoal, deadline, "fork:crc-unwrap");
    const project = await registry.getProject(projectId);
    const vault = await ethers.getContractAt("FundedProjectVaultV2", project.vault);
    const tokenId = BigInt(GNOSIS_APP_OWNER);
    const ownerBalanceBefore = await hub.balanceOf(GNOSIS_APP_OWNER, tokenId);
    await wrapper.unwrap(rawGoal);
    await hub.connect(owner).safeTransferFrom(GNOSIS_APP_OWNER, project.vault, tokenId, rawGoal, "0x");
    await vault.connect(owner).withdraw("CRC unwrap fork test");

    assert.equal(await hub.balanceOf(project.vault, tokenId), 0n);
    assert.equal(await hub.balanceOf(GNOSIS_APP_OWNER, tokenId), ownerBalanceBefore + rawGoal);
  });
});
