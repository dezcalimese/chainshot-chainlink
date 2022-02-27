const hre = require('hardhat');
const { ethers } = require("hardhat");
const { assert } = require("chai");
const vrfCoordinatorABI = require("@chainlink/contracts/abi/v0.6/VRFCoordinator.json");

const LINK_ADDR = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
const VRF_ADDR = "0xf0d54349aDdcf704F77AE15b96510dEA15cb7952";

describe('PriceConsumerV3', function () {
    let contract;
    beforeEach(async () => {
        const PriceConsumerV3 = await ethers.getContractFactory("PriceConsumerV3");
        contract = await PriceConsumerV3.deploy();
        await contract.deployed();
    });

    it('should find the ETH / USD address', async () => {
        const ethUsdAddress = await contract.priceFeed();
        let expectedAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
        assert(ethUsdAddress === expectedAddress, "The Price Feed was not the expected address! Find the Ethereum Mainnet ETH/USD Price Feed.");
    });

    it('should retrieve the latest ETH/USD price', async () => {
        const price = await contract.getLatestPrice();
        assert(price.eq("178504000000"), "Did not receive the expected price from the PriceConsumer! Did you call priceFeed.latestRoundData?");
    });
});

describe('RandomNumberConsumer - VRFConsumerBase', function () {
    describe('when the price is higher', () => {
        let contract;
        beforeEach(async () => {
            const RandomNumberConsumer = await ethers.getContractFactory("RandomNumberConsumer");
            contract = await RandomNumberConsumer.deploy();
            await contract.deployed();
        });

        it("should have the correct fee", async () => {
            const fee = await contract.fee();
            const expectedFee = ethers.utils.parseEther("2");
            assert(fee.eq(expectedFee), `Did not get the correct fee! It should 2 LINK, you provided: ${fee.toString()}`);
        });

        it('should have the correct keyhash', async () => {
            const keyhash = await contract.keyHash();
            const expectedKeyHash = "0xAA77729D3466CA35AE8D28B3BBAC7CC36A5031EFDC430821C02BC31A238AF445";
            assert(keyhash.toLowerCase() === expectedKeyHash.toLowerCase());
        });
        
        it('should have the right addresses', async () => {
            const bytecode = contract.deployTransaction.data.toLowerCase();
            const expectedVrfCoordinator = ("f0d54349aDdcf704F77AE15b96510dEA15cb7952").toLowerCase();
            const vrfIndex = bytecode.indexOf(expectedVrfCoordinator);
            const expectedLink = ("514910771AF9Ca656af840dff83E8264EcF986CA").toLowerCase();
            const linkIndex = bytecode.indexOf(expectedLink);
            assert(vrfIndex >= 0, "You did not deploy the correct Ethereum Mainnet VRF Coordinator Address.");
            assert(linkIndex >= 0, "You did not deploy the correct LINK Mainnet Token Address.");
            assert(linkIndex > vrfIndex, "It looks like you passed in the VRF Address and Link Token to the constructor in the wrong order.");
        });
    });
});

describe('RandomNumberConsumer - VRF Request', function () {
    let contract, linkToken, addr1;
    let fundingAmount = ethers.utils.parseEther("10");
    beforeEach(async () => {
        linkToken = await ethers.getContractAt("LinkTokenInterface", LINK_ADDR);

        const RandomNumberConsumer = await ethers.getContractFactory("RandomNumberConsumer");
        contract = await RandomNumberConsumer.deploy();
        await contract.deployed();

        [addr1] = await ethers.provider.listAccounts();
        await modifyLinkBalance(addr1, fundingAmount);
        await linkToken.transfer(contract.address, fundingAmount);
    });

    it("should have a balance of LINK", async () => {
        const balance = await linkToken.balanceOf(contract.address);
        assert(balance.eq(fundingAmount));
    });

    describe("after requesting a random number", () => {
        let receipt, requestId, randomnessRequestEvent;
        beforeEach(async () => {
            const tx = await contract.getRandomNumber();
            receipt = await tx.wait();
            const interface = new ethers.utils.Interface(vrfCoordinatorABI);
            const events = receipt.logs.filter(x => x.address === VRF_ADDR).map(x => interface.parseLog(x));
            randomnessRequestEvent = events.find(x => x.name === "RandomnessRequest");
            requestId = randomnessRequestEvent.args.requestID;
        });

        it('should create the randomness request in the coordinator', async () => {
            assert(randomnessRequestEvent);
            assert.equal(randomnessRequestEvent.args.sender, contract.address);
        });

        describe("after fulfilling the request", () => {
            const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
            beforeEach(async () => {
                // give gas money to the VRF coordinator 
                await network.provider.send("hardhat_setBalance", [
                    VRF_ADDR,
                    "0xde0b6b3a7640000"
                ]);
                // impersonate the VRF coordinator to fullfill randomness 
                await hre.network.provider.request({
                    method: "hardhat_impersonateAccount",
                    params: [VRF_ADDR],
                });
                const signer = await ethers.provider.getSigner(VRF_ADDR);
                await contract.connect(signer).rawFulfillRandomness(requestId, randomValue);
            });

            it("should store the randomness", async () => {
                const randomResult = await contract.randomResult();
                assert(randomResult.eq(randomValue));
            });
        });
    });
});

describe('APIConsumer', function () {
    let contract, linkToken, addr1;
    let fundingAmount = ethers.utils.parseEther("10");
    
    before(async () => {
        linkToken = await ethers.getContractAt("LinkTokenInterface", LINK_ADDR);

        // impersonate deployer address to keep the oracle address deterministic 
        await setBalance(deployerAddr, ethers.utils.parseEther("10"));
        const signer = impersonate(deployerAddr);
        const Oracle = await ethers.getContractFactory("Oracle", signer);
        oracle = await Oracle.deploy();
        await oracle.deployed(); // 0x3Aa5ebB10DC797CAC828524e59A333d0A371443c

        const APIConsumer = await ethers.getContractFactory("APIConsumer");
        contract = await APIConsumer.deploy();
        await contract.deployed();

        [addr1] = await ethers.provider.listAccounts();
        await modifyLinkBalance(addr1, fundingAmount);
        await linkToken.transfer(contract.address, fundingAmount);
    });

    it("should have a balance of LINK", async () => {
        const balance = await linkToken.balanceOf(contract.address);
        assert(balance.eq(fundingAmount));
    });

    describe("after making the oracle request", () => {
        let receipt;
        before(async () => {
            const tx = await contract.requestRainfall();
            receipt = await tx.wait();
        });

        it('should have paid the fee to the oracle', async () => {
            const balance = await linkToken.balanceOf(oracle.address);
            const expected = ethers.utils.parseEther(".1");
            assert.equal(balance.toString(), expected.toString());
        });

        it('should have made the request to the oracle', async () => {
            const url = "0x63676574781b687474703a2f2f7261696e66616c6c2d6f7261636c652e636f6d";
            const path = "647061746878257261696e66616c6c732e696f77612e73657074656d6265722e323032312e61766572616765";
            const request = await oracle.request();
            assert(request.indexOf(url) >= 0, "Did not properly parse the rainfall. Your path should start with rainfalls.iowa... and resolve the average.");
            assert(request.endsWith(path), "Did not properly parse the rainfall. Your path should start with rainfalls.iowa... and resolve the average.");
        });
        
        describe("after fulfilling the request", async () => {
            const rainfall = 45720;
            before(async () => {
                const oracleSigner = await impersonate(oracle.address);
                await setBalance(oracle.address, ethers.utils.parseEther("1"));
                const event = receipt.events.find(x => x.event === "ChainlinkRequested");
                await contract.connect(oracleSigner).fulfill(event.args.id, rainfall);
            });

            it("should set the rainfall", async () => {
                const actual = await contract.rainfall();
                assert.equal(actual, rainfall);
            });
        });
    });
});

async function impersonate(addr) {
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    });
    return await ethers.provider.getSigner(addr);
}

async function setBalance(addr, balance) {
    await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [addr, ethers.utils.hexValue(balance)],
    });
}

async function modifyLinkBalance(addr, balance) {
    const storageSlot = ethers.utils.hexZeroPad(1, "32");
    const paddedAddr = ethers.utils.hexZeroPad(addr, "32");
    const slot = ethers.utils.keccak256(paddedAddr + storageSlot.slice(2));
    const paddedBalance = ethers.utils.hexZeroPad(balance, "32");
    await hre.network.provider.request({
        method: "hardhat_setStorageAt",
        params: [LINK_ADDR, slot, paddedBalance],
    });
}