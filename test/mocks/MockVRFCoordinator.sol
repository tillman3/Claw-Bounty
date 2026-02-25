// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/vendor/chainlink/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "../../src/vendor/chainlink/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @notice Minimal mock VRF Coordinator for testing
contract MockVRFCoordinator {
    uint256 private _nextRequestId = 1;

    // Store last request so test can trigger callback
    uint256 public lastRequestId;
    address public lastRequester;

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata /* request */
    )
        external
        returns (uint256 requestId)
    {
        requestId = _nextRequestId++;
        lastRequestId = requestId;
        lastRequester = msg.sender;
    }

    /// @notice Test helper: simulate VRF callback
    function fulfillRandomWords(address consumer, uint256 requestId, uint256[] calldata randomWords) external {
        // Call rawFulfillRandomWords on the consumer
        (bool ok,) =
            consumer.call(abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, randomWords));
        require(ok, "VRF callback failed");
    }
}
