// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

contract Capsule is KeeperCompatibleInterface {
    uint lockedUntil;
    address payable recipient;

    /// @notice This function takes the `lockedUntil` value and stores it on the smart contract.
    function deposit(uint _lockedUntil) external payable {
        require(lockedUntil == 0);
        lockedUntil = _lockedUntil;
        recipient = payable(msg.sender);
        
    }

    /// @notice This function will be called by a keeper as a query to see whether or not the contract requries upkeep. 
    function checkUpkeep(bytes calldata) external view override returns (bool, bytes memory) {
        bool upkeepNeeded = lockedUntil > 0 && block.timestamp > lockedUntil;
        return (upkeepNeeded, "0x");
    }

    /// @notice This function pays out the deposited ether 
    function performUpkeep(bytes calldata) external override {
        require(block.timestamp > lockedUntil);
        recipient.transfer(address(this).balance);
        delete lockedUntil;
    }   
}