// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface IMockERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

contract MockCirclesHub {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    error InsufficientBalance();
    error LengthMismatch();
    error UnsafeRecipient();

    function mint(address account, uint256 id, uint256 amount) external {
        balanceOf[account][id] += amount;
    }

    function burn(address account, uint256 id, uint256 amount) external {
        if (balanceOf[account][id] < amount) revert InsufficientBalance();
        balanceOf[account][id] -= amount;
    }

    function transferTo(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        if (balanceOf[from][id] < amount) revert InsufficientBalance();
        balanceOf[from][id] -= amount;
        balanceOf[to][id] += amount;

        if (to.code.length != 0) {
            bytes4 result = IMockERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data);
            if (result != IMockERC1155Receiver.onERC1155Received.selector) revert UnsafeRecipient();
        }
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external {
        if (msg.sender != from) revert UnsafeRecipient();
        if (ids.length != values.length) revert LengthMismatch();

        for (uint256 i; i < ids.length; ++i) {
            if (balanceOf[from][ids[i]] < values[i]) revert InsufficientBalance();
            balanceOf[from][ids[i]] -= values[i];
            balanceOf[to][ids[i]] += values[i];
        }

        if (to.code.length != 0) {
            bytes4 result = IMockERC1155Receiver(to).onERC1155BatchReceived(
                msg.sender,
                from,
                ids,
                values,
                data
            );
            if (result != IMockERC1155Receiver.onERC1155BatchReceived.selector) revert UnsafeRecipient();
        }
    }
}
