// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1155Receiver {
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

interface ICirclesHub {
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external;
}

contract FundedProjectEscrow is IERC1155Receiver {
    struct Project {
        address owner;
        uint256 goal;
        uint256 deadline;
        uint256 raised;
        bool withdrawn;
        string metadataURI;
    }

    ICirclesHub public immutable hub;

    mapping(bytes32 => Project) public projects;
    mapping(bytes32 => uint256[]) private projectTokenIds;
    mapping(bytes32 => mapping(uint256 => uint256)) public projectTokenBalances;

    event ProjectCreated(bytes32 indexed projectId, address indexed owner, uint256 goal, uint256 deadline, string metadataURI);
    event ProjectFunded(bytes32 indexed projectId, address indexed contributor, uint256 indexed tokenId, uint256 amount);
    event ProjectWithdrawn(bytes32 indexed projectId, address indexed owner, uint256 amount, string note);

    error OnlyHub();
    error ProjectAlreadyExists();
    error ProjectNotFound();
    error NotProjectOwner();
    error DeadlineInPast();
    error WithdrawNotAllowed();
    error AlreadyWithdrawn();
    error InvalidProjectData();

    constructor(address _hub) {
        hub = ICirclesHub(_hub);
    }

    function createProject(bytes32 projectId, uint256 goal, uint256 deadline, string calldata metadataURI) external {
        if (projects[projectId].owner != address(0)) revert ProjectAlreadyExists();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        projects[projectId] = Project({
            owner: msg.sender,
            goal: goal,
            deadline: deadline,
            raised: 0,
            withdrawn: false,
            metadataURI: metadataURI
        });

        emit ProjectCreated(projectId, msg.sender, goal, deadline, metadataURI);
    }

    function withdraw(bytes32 projectId, string calldata note) external {
        Project storage project = projects[projectId];
        if (project.owner == address(0)) revert ProjectNotFound();
        if (msg.sender != project.owner) revert NotProjectOwner();
        if (project.withdrawn) revert AlreadyWithdrawn();
        if (project.raised < project.goal && block.timestamp < project.deadline) revert WithdrawNotAllowed();

        uint256[] storage storedIds = projectTokenIds[projectId];
        uint256[] memory ids = new uint256[](storedIds.length);
        uint256[] memory values = new uint256[](storedIds.length);
        uint256 total;

        for (uint256 i = 0; i < storedIds.length; i++) {
            uint256 tokenId = storedIds[i];
            uint256 amount = projectTokenBalances[projectId][tokenId];
            ids[i] = tokenId;
            values[i] = amount;
            total += amount;
            projectTokenBalances[projectId][tokenId] = 0;
        }

        project.withdrawn = true;
        hub.safeBatchTransferFrom(address(this), project.owner, ids, values, bytes(note));
        emit ProjectWithdrawn(projectId, project.owner, total, note);
    }

    function tokenIdsFor(bytes32 projectId) external view returns (uint256[] memory) {
        return projectTokenIds[projectId];
    }

    function onERC1155Received(
        address,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4) {
        if (msg.sender != address(hub)) revert OnlyHub();
        bytes32 projectId;
        if (data.length == 32) {
            projectId = abi.decode(data, (bytes32));
        } else {
            (projectId,) = abi.decode(data, (bytes32, bytes));
        }
        Project storage project = projects[projectId];
        if (project.owner == address(0)) revert ProjectNotFound();
        if (project.withdrawn) revert AlreadyWithdrawn();

        if (projectTokenBalances[projectId][id] == 0) {
            projectTokenIds[projectId].push(id);
        }
        projectTokenBalances[projectId][id] += value;
        project.raised += value;

        emit ProjectFunded(projectId, from, id, value);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert InvalidProjectData();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
