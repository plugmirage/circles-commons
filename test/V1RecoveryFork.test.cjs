const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");

const describeFork = process.env.GNOSIS_FORK_RPC_URL ? describe : describe.skip;

describeFork("V1 demurrage recovery on a Gnosis fork", function () {
  const HUB = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
  const ESCROW = "0x16117dd001A9f57347768365fFc0c90084eaa7E5";
  const OWNER = "0x2DD131AAfdD8f0B95f480904A52C3e8334640496";
  const CONTRIBUTOR = "0x450aa7bc6bb83b05f696b6024fdde99188939c8b";
  const TOKEN_ID = 394157982506849793806702747563005393429287115915n;
  const TARGET_PROJECT = "0xae3d53d645a884b41ce082c39b1aa343a5d5bfa28fb3fb7c14102bbb63780ad4";
  const CRC = 10n ** 18n;

  const hubAbi = [
    "function balanceOf(address account,uint256 id) view returns(uint256)",
    "function safeTransferFrom(address from,address to,uint256 id,uint256 value,bytes data)"
  ];
  const escrowAbi = [
    "function createProject(bytes32 projectId,uint256 goal,uint256 deadline,string metadataURI)",
    "function withdraw(bytes32 projectId,string note)",
    "function projects(bytes32) view returns(address owner,uint256 goal,uint256 deadline,uint256 raised,bool withdrawn,string metadataURI)"
  ];

  it("unblocks the target withdrawal with a sacrificial same-token micro-contribution", async function () {
    for (const address of [OWNER, CONTRIBUTOR]) {
      await network.provider.request({ method: "hardhat_setBalance", params: [address, "0x56BC75E2D63100000"] });
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
    }

    const owner = await ethers.getSigner(OWNER);
    const contributor = await ethers.getSigner(CONTRIBUTOR);
    const hub = new ethers.Contract(HUB, hubAbi, contributor);
    const escrowAsOwner = new ethers.Contract(ESCROW, escrowAbi, owner);
    const repairProject = ethers.keccak256(ethers.toUtf8Bytes("circles-commons:v1-repair:2026-06-09"));
    const latest = await ethers.provider.getBlock("latest");
    const repairAmount = CRC / 100n;

    await escrowAsOwner.createProject(
      repairProject,
      repairAmount,
      BigInt(latest.timestamp + 24 * 60 * 60),
      "recovery:v1-demurrage"
    );
    await hub.safeTransferFrom(
      CONTRIBUTOR,
      ESCROW,
      TOKEN_ID,
      repairAmount,
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [repairProject])
    );

    const targetBefore = await escrowAsOwner.projects(TARGET_PROJECT);
    assert.equal(targetBefore.withdrawn, false);
    const ownerBalanceBefore = await hub.balanceOf(OWNER, TOKEN_ID);
    await escrowAsOwner.withdraw(TARGET_PROJECT, "Recovered after V1 demurrage rounding");
    const ownerBalanceAfter = await hub.balanceOf(OWNER, TOKEN_ID);
    const targetAfter = await escrowAsOwner.projects(TARGET_PROJECT);

    assert.equal(targetAfter.withdrawn, true);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, 10n * CRC);
  });
});
