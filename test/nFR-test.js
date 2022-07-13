const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");

describe("nFR implementation contract", function() {

	const numGenerations = 10;

	const percentOfProfit = ethers.utils.parseUnits("0.16");

	const successiveRatio = ethers.utils.parseUnits("1.19");

	const baseSale = ethers.utils.parseUnits("1");

	const saleIncrementor = "0.5";

	const tokenId = 1;

	let nFRFactory;
	let nFR;
	let owner;
	let addrs;

	beforeEach(async function() {
		nFRFactory = await ethers.getContractFactory("MyNFT");
		[owner, ...addrs] = await ethers.getSigners();

		nFR = await nFRFactory.deploy();

		await nFR.mintNFT(owner.address, numGenerations, percentOfProfit, successiveRatio, "");
	});

	describe("Deployment and Retrieval", function() {
		it("Should mint to the proper owner", async function() {
			expect(await nFR.ownerOf(tokenId)).to.equal(owner.address);
		});

		it("Should set and retrieve the correct FR info", async function() {
			let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("1"), [owner.address]]; // ..., lastSoldPrice, ownerAmount, addressesInFR
			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal(expectedArray);
		});

		it("Should return the proper allotted FR", async function() {
			expect(await nFR.retrieveAllottedFR(owner.address)).to.equal(ethers.BigNumber.from("0"));
		});

		it("Should return the proper list info", async function() {
			expect(await nFR.retrieveListInfo(tokenId)).deep.to.equal([ ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
		});

	});

	describe("ERC721 Transactions", function() {
		it("Should fail mint without default FR info", async function() {
			await expect(nFR.mintERC721(owner.address, "")).to.be.revertedWith("No Default FR Info has been set");
		});

		it("Should successfully set default FR info and mint", async function() {
			await nFR.setDefaultFRInfo(numGenerations, percentOfProfit, successiveRatio);
			await nFR.mintERC721(owner.address, "")
			expect(await nFR.ownerOf("2")).to.equal(owner.address);
		});

		it("Should treat ERC721 transfer as an unprofitable sale and update data accordingly", async function() {
			await nFR["transferFrom(address,address,uint256)"](owner.address, addrs[0].address, tokenId);

			let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address]];
			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal(expectedArray);
		});

		it("Should shift generations properly even if there have only been ERC721 transfers", async function() {
			await nFR["transferFrom(address,address,uint256)"](owner.address, addrs[0].address, tokenId);

			for (let transfers = 0; transfers < 9; transfers++) { // This results in 11 total owners, minter, transfer, 9 more transfers.
				let signer = nFR.connect(addrs[transfers]);

				await signer["transferFrom(address,address,uint256)"](addrs[transfers].address, addrs[transfers + 1].address, tokenId);
			}

			let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.BigNumber.from("0"), ethers.BigNumber.from("11"), []];

			for (let a = 0; a < 10; a++) {
				expectedArray[5].push(addrs[a].address);
			}

			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal(expectedArray);

			expect(await waffle.provider.getBalance(nFR.address)).to.equal(ethers.BigNumber.from("0"));
		});

		it("Should delete FR info upon burning of NFT", async function() {
			await nFR.burnNFT(tokenId);

			let expectedArray = [0, ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), ethers.BigNumber.from("0"), []];
			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal(expectedArray);
		});
	});

	describe("nFR Transactions", function() {

		it("Should fail list if not owner", async function() {
			let signer = nFR.connect(addrs[0]);

			await expect(signer.list(tokenId, ethers.utils.parseUnits("1"))).to.be.revertedWith("ERC5173: list caller is not owner nor approved");
		});

		it("Should fail unlist if not owner", async function() {
			let signer = nFR.connect(addrs[0]);

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await expect(signer.unlist(tokenId)).to.be.revertedWith("ERC5173: unlist caller is not owner nor approved");
		});

		it("Should revert buy if NFT is not listed", async function() {
			let signer = nFR.connect(addrs[0]);

			await expect(signer.buy(tokenId, { value: ethers.utils.parseUnits("0.5") })).to.be.revertedWith("Token is not listed");
		});

		it("Should revert buy if msg.value is not equal to salePrice", async function() {
			let signer = nFR.connect(addrs[0]);

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await expect(signer.buy(tokenId, { value: ethers.utils.parseUnits("0.5") })).to.be.revertedWith("salePrice and msg.value mismatch");
		});

		it("Should list properly", async function() {
			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			expect(await nFR.retrieveListInfo(tokenId)).deep.to.equal([ ethers.utils.parseUnits("1"), owner.address, true ]);
		});

		it("Should unlist properly", async function() {
			await nFR.unlist(tokenId);

			expect(await nFR.retrieveListInfo(tokenId)).deep.to.equal([ ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
		});

		it("Should treat a profitable transaction properly", async function() {
			let signer = nFR.connect(addrs[0]);

			let balanceBefore = await waffle.provider.getBalance(addrs[0].address);

			let expectedBalance = balanceBefore.sub(ethers.utils.parseUnits("0.16"));

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await signer.buy(tokenId, {
				value: ethers.utils.parseUnits("1")
			});

			expect(await waffle.provider.getBalance(addrs[0].address)).to.be.below(expectedBalance);
			expect(await nFR.retrieveAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0.16"));
			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("1"), ethers.BigNumber.from("2"), [owner.address, addrs[0].address] ]);
		});

		it("Should treat an unprofitable transaction properly", async function() {
			let signer = await nFR.connect(addrs[0]);

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await signer.buy(tokenId, {
				value: ethers.utils.parseUnits("1")
			});

			let secondSigner = await nFR.connect(addrs[1]);

			let balanceBefore = await waffle.provider.getBalance(addrs[0].address);

			await signer.list(tokenId, ethers.utils.parseUnits("0.5"));

			await secondSigner.buy(tokenId, { value: ethers.utils.parseUnits("0.5") });

			expect(await waffle.provider.getBalance(addrs[0].address)).to.be.above(balanceBefore.sub(ethers.utils.parseUnits("0.001")));
			expect(await nFR.retrieveAllottedFR(addrs[0].address)).to.equal(ethers.utils.parseUnits("0"));
			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal([ numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("0.5"), ethers.BigNumber.from("3"), [owner.address, addrs[0].address, addrs[1].address] ]);
		});

		it("Should reset list info after sale", async function() {
			let signer = await nFR.connect(addrs[0]);

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await signer.buy(tokenId, {
				value: ethers.utils.parseUnits("1")
			});

			expect(await nFR.retrieveListInfo(tokenId)).deep.to.equal([ ethers.BigNumber.from("0"), ethers.constants.AddressZero, false ]);
		});

		it("Should fail if improper data passed to default FR info", async function() {
			await expect(nFR.setDefaultFRInfo("0", percentOfProfit, successiveRatio)).to.be.revertedWith("Invalid Data Passed");
			await expect(nFR.setDefaultFRInfo(numGenerations, ethers.utils.parseUnits("2"), successiveRatio)).to.be.revertedWith("Invalid Data Passed");
			await expect(nFR.setDefaultFRInfo(numGenerations, percentOfProfit, ethers.utils.parseUnits("0"))).to.be.revertedWith("Invalid Data Passed");
		});

		it("Should run through 10 FR generations successfully", async function() {
			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			let s = nFR.connect(addrs[0]);

			await s.buy(tokenId, { value: ethers.utils.parseUnits("1") });

			for (let transfers = 0; transfers < 9; transfers++) { // This results in 11 total owners, minter, transfer, 9 more transfers.
				let signer = nFR.connect(addrs[transfers]);
				let secondSigner = nFR.connect(addrs[transfers + 1]);

				let salePrice = (await nFR.retrieveFRInfo(tokenId))[3].add(ethers.utils.parseUnits(saleIncrementor)); // Get lastSoldPrice and add incrementor

				await signer.list(tokenId, salePrice);

				await secondSigner.buy(tokenId, { value: salePrice });
			}

			let expectedArray = [numGenerations, percentOfProfit, successiveRatio, ethers.utils.parseUnits("5.5"), ethers.BigNumber.from("11"), []];

			for (let a = 0; a < 10; a++) {
				expectedArray[5].push(addrs[a].address);
			}

			expect(await nFR.retrieveFRInfo(tokenId)).deep.to.equal(expectedArray);

			expect(await waffle.provider.getBalance(nFR.address)).to.be.above(ethers.utils.parseUnits("0.879")); // (0.16) + (9 * 0.5 * 0.16) - Taking fixed-point dust into account

			let totalOwners = [owner.address, ...expectedArray[5]];

			let allottedFRs = [];

			for (let o of totalOwners) allottedFRs.push(await nFR.retrieveAllottedFR(o));

			let greatestFR = allottedFRs.reduce((m, e) => e.gt(m) ? e : m);

			expect(greatestFR).to.equal(allottedFRs[0]);
		});

		it("Should emit FRDistributed", async function() {
			let signer = nFR.connect(addrs[0]);

			await nFR.list(tokenId, ethers.utils.parseUnits("1"));

			await expect(signer.buy(tokenId, { value: ethers.utils.parseUnits("1") })).to.emit(nFR, "FRDistributed")
			.withArgs(tokenId, ethers.utils.parseUnits("1"), ethers.utils.parseUnits("0.16"));
		});

		describe("Claiming", function() {
			it("Should release FR if allotted, and update state accordingly", async function() {
				let signer = nFR.connect(addrs[0]);

				await nFR.list(tokenId, ethers.utils.parseUnits("1"));

				await signer.buy(tokenId, { value: ethers.utils.parseUnits("1") });

				expect(await nFR.retrieveAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0.16"));
				expect(await waffle.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0.16"));

				let expectedBalance = (await waffle.provider.getBalance(owner.address)).add(ethers.utils.parseUnits("0.1599"));

				await nFR.releaseFR(owner.address);

				expect(await nFR.retrieveAllottedFR(owner.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await waffle.provider.getBalance(nFR.address)).to.equal(ethers.utils.parseUnits("0"));
				expect(await waffle.provider.getBalance(owner.address)).to.be.above(expectedBalance);
			});

			it("Should revert if no FR allotted", async function() {
				await expect(nFR.releaseFR(owner.address)).to.be.revertedWith("No FR Payment due");
			});

			it("Should emit FRClaimed", async function() {
				let signer = nFR.connect(addrs[0]);

				await nFR.list(tokenId, ethers.utils.parseUnits("1"));

				await signer.buy(tokenId, { value: ethers.utils.parseUnits("1") });

				await expect(nFR.releaseFR(owner.address)).to.emit(nFR, "FRClaimed").withArgs(owner.address, ethers.utils.parseUnits("0.16"));
			});
		});
	});


});