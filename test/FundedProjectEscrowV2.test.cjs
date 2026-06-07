const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("FundedProjectEscrowV2", function () {
  const CRC = 10n ** 18n;
  const projectId = ethers.keccak256(ethers.toUtf8Bytes("project-one"));
  const metadata = "supabase:projects:project-one";

  async function deployFixture() {
    const [owner, contributor, attacker] = await ethers.getSigners();
    const Hub = await ethers.getContractFactory("MockCirclesHub");
    const hub = await Hub.deploy();
    const Registry = await ethers.getContractFactory("FundedProjectEscrowV2");
    const registry = await Registry.deploy(await hub.getAddress());
    return { owner, contributor, attacker, hub, registry };
  }

  async function createProject(fixture, goal = 100n * CRC) {
    const latest = await ethers.provider.getBlock("latest");
    const deadline = BigInt(latest.timestamp + 14 * 24 * 60 * 60);
    await fixture.registry.connect(fixture.owner).createProject(projectId, goal, deadline, metadata);
    const project = await fixture.registry.getProject(projectId);
    return {
      ...fixture,
      deadline,
      vault: await ethers.getContractAt("FundedProjectVaultV2", project.vault)
    };
  }

  it("creates an isolated vault owned by the project creator", async function () {
    const fixture = await createProject(await deployFixture());
    assert.equal(await fixture.vault.owner(), fixture.owner.address);
    assert.equal(await fixture.vault.goal(), 100n * CRC);
    assert.equal(await fixture.vault.projectId(), projectId);
  });

  it("rejects invalid projects and duplicate IDs", async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = BigInt(latest.timestamp + 7200);
    await assert.rejects(fixture.registry.createProject(ethers.ZeroHash, 100n, deadline, metadata));
    await assert.rejects(fixture.registry.createProject(projectId, 0, deadline, metadata));
    await fixture.registry.createProject(projectId, 100n, deadline, metadata);
    await assert.rejects(fixture.registry.createProject(projectId, 100n, deadline, metadata));
  });

  it("accepts funding, prevents overfunding, and closes at the goal", async function () {
    const fixture = await createProject(await deployFixture(), 10n * CRC);
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, 11n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 9n * CRC, "0x");
    assert.equal(await fixture.vault.raised(), 9n * CRC);
    await assert.rejects(
      fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 2n * CRC, "0x")
    );
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, CRC, "0x");
    await assert.rejects(
      fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, CRC, "0x")
    );
  });

  it("rejects funding at and after the deadline", async function () {
    const fixture = await createProject(await deployFixture());
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, CRC);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(fixture.deadline)]);
    await assert.rejects(
      fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, CRC, "0x")
    );
  });

  it("only allows the owner to withdraw after the goal", async function () {
    const fixture = await createProject(await deployFixture(), 10n * CRC);
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, 10n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 10n * CRC, "0x");
    await assert.rejects(fixture.vault.connect(fixture.attacker).withdraw("steal"));
    await fixture.vault.connect(fixture.owner).withdraw("Project funded");
    assert.equal(await fixture.hub.balanceOf(fixture.owner.address, tokenId), 10n * CRC);
    assert.equal(await fixture.vault.withdrawn(), true);
    await assert.rejects(fixture.vault.connect(fixture.owner).withdraw("again"));
  });

  it("withdraws the real post-demurrage balance rather than stale accounting", async function () {
    const fixture = await createProject(await deployFixture(), 10n * CRC);
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, 10n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 10n * CRC, "0x");
    await fixture.hub.burn(await fixture.vault.getAddress(), tokenId, CRC / 10n);
    await fixture.vault.connect(fixture.owner).withdraw("After demurrage");
    assert.equal(await fixture.hub.balanceOf(fixture.owner.address, tokenId), 99n * CRC / 10n);
  });

  it("allows withdrawal after the deadline even below the goal", async function () {
    const fixture = await createProject(await deployFixture(), 100n * CRC);
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, 5n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 5n * CRC, "0x");
    await assert.rejects(fixture.vault.connect(fixture.owner).withdraw("too soon"));
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(fixture.deadline)]);
    await ethers.provider.send("evm_mine");
    await fixture.vault.connect(fixture.owner).withdraw("Deadline reached");
    assert.equal(await fixture.hub.balanceOf(fixture.owner.address, tokenId), 5n * CRC);
  });

  it("handles multiple CRC token IDs in one small-project withdrawal", async function () {
    const fixture = await createProject(await deployFixture(), 10n * CRC);
    const firstId = BigInt(fixture.contributor.address);
    const secondId = BigInt(fixture.attacker.address);
    await fixture.hub.mint(fixture.contributor.address, firstId, 5n * CRC);
    await fixture.hub.mint(fixture.attacker.address, secondId, 5n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), firstId, 5n * CRC, "0x");
    await fixture.hub.transferTo(fixture.attacker.address, await fixture.vault.getAddress(), secondId, 5n * CRC, "0x");
    await fixture.vault.connect(fixture.owner).withdraw("All currencies");
    assert.equal(await fixture.hub.balanceOf(fixture.owner.address, firstId), 5n * CRC);
    assert.equal(await fixture.hub.balanceOf(fixture.owner.address, secondId), 5n * CRC);
  });

  it("rejects direct receiver calls and batch deposits", async function () {
    const fixture = await createProject(await deployFixture());
    await assert.rejects(
      fixture.vault.onERC1155Received(fixture.owner.address, fixture.owner.address, 1n, 1n, "0x")
    );
    await assert.rejects(
      fixture.vault.onERC1155BatchReceived(fixture.owner.address, fixture.owner.address, [1n], [1n], "0x")
    );
  });

  it("withdraws a large project over multiple bounded batches", async function () {
    const fixture = await createProject(await deployFixture(), 505n * CRC);
    const vaultAddress = await fixture.vault.getAddress();
    for (let index = 1n; index <= 101n; index += 1n) {
      const contributor = ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(index + 1000n), 20));
      await fixture.hub.mint(contributor, index, 5n * CRC);
      await fixture.hub.transferTo(contributor, vaultAddress, index, 5n * CRC, "0x");
    }
    assert.equal((await fixture.vault.tokenIdsForProject()).length, 101);
    assert.equal(await fixture.vault.usesBatchWithdrawal(), true);
    await assert.rejects(fixture.vault.connect(fixture.owner).withdraw("wrong mode"));
    await fixture.vault.connect(fixture.owner).withdrawBatch(50, "Batch one");
    assert.equal(await fixture.vault.withdrawalCursor(), 50n);
    assert.equal(await fixture.vault.withdrawn(), false);
    await fixture.vault.connect(fixture.owner).withdrawBatch(50, "Batch two");
    assert.equal(await fixture.vault.withdrawalCursor(), 100n);
    await fixture.vault.connect(fixture.owner).withdrawBatch(50, "Batch three");
    assert.equal(await fixture.vault.withdrawalCursor(), 101n);
    assert.equal(await fixture.vault.withdrawn(), true);
    assert.equal(await fixture.vault.withdrawnAmount(), 505n * CRC);
  });

  it("rejects invalid deadlines and metadata", async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");
    await assert.rejects(
      fixture.registry.createProject(projectId, CRC, BigInt(latest.timestamp + 60), metadata)
    );
    await assert.rejects(
      fixture.registry.createProject(projectId, CRC, BigInt(latest.timestamp + 91 * 24 * 60 * 60), metadata)
    );
    await assert.rejects(
      fixture.registry.createProject(projectId, CRC, BigInt(latest.timestamp + 7200), "")
    );
    await assert.rejects(
      fixture.registry.createProject(projectId, CRC, BigInt(latest.timestamp + 7200), "x".repeat(513))
    );
  });

  it("rejects premature withdrawals and oversized public notes", async function () {
    const fixture = await createProject(await deployFixture(), 10n * CRC);
    const tokenId = BigInt(fixture.contributor.address);
    await fixture.hub.mint(fixture.contributor.address, tokenId, 10n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 5n * CRC, "0x");
    await assert.rejects(fixture.vault.connect(fixture.owner).withdraw("too soon"));
    await fixture.hub.transferTo(fixture.contributor.address, await fixture.vault.getAddress(), tokenId, 5n * CRC, "0x");
    await assert.rejects(fixture.vault.connect(fixture.owner).withdraw("x".repeat(1025)));
  });

  it("allows repeated contributions and different CRC token IDs from the same contributor", async function () {
    const fixture = await createProject(await deployFixture(), 100n * CRC);
    const vaultAddress = await fixture.vault.getAddress();
    const firstId = 101n;
    const secondId = 102n;
    await fixture.hub.mint(fixture.contributor.address, firstId, 20n * CRC);
    await fixture.hub.mint(fixture.contributor.address, secondId, 10n * CRC);
    await fixture.hub.transferTo(fixture.contributor.address, vaultAddress, firstId, 10n * CRC, "0x");
    await fixture.hub.transferTo(fixture.contributor.address, vaultAddress, firstId, 10n * CRC, "0x");
    await fixture.hub.transferTo(fixture.contributor.address, vaultAddress, secondId, 10n * CRC, "0x");
    assert.equal(await fixture.vault.raised(), 30n * CRC);
    assert.equal((await fixture.vault.tokenIdsForProject()).length, 2);
  });

  it("rejects dust except when it exactly completes the remaining goal", async function () {
    const fixture = await createProject(await deployFixture(), 12n * CRC);
    const vaultAddress = await fixture.vault.getAddress();
    const tokenId = 101n;
    await fixture.hub.mint(fixture.contributor.address, tokenId, 12n * CRC);
    await assert.rejects(
      fixture.hub.transferTo(fixture.contributor.address, vaultAddress, tokenId, 2n * CRC, "0x")
    );
    await fixture.hub.transferTo(fixture.contributor.address, vaultAddress, tokenId, 10n * CRC, "0x");
    await fixture.hub.transferTo(fixture.contributor.address, vaultAddress, tokenId, 2n * CRC, "0x");
    assert.equal(await fixture.vault.raised(), 12n * CRC);
  });
});
