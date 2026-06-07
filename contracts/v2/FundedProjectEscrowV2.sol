// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface ICirclesHubV2 {
    function balanceOf(address account, uint256 id) external view returns (uint256);

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external;
}

interface IERC1155ReceiverV2 {
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

contract FundedProjectVaultV2 is IERC1155ReceiverV2 {
    uint256 public constant MAX_NOTE_BYTES = 1_024;
    uint256 public constant MIN_CONTRIBUTION = 5 ether;
    uint256 public constant BATCH_WITHDRAWAL_GOAL = 500 ether;
    uint256 public constant MAX_BATCH_SIZE = 50;

    ICirclesHubV2 public immutable hub;
    bytes32 public immutable projectId;
    address public immutable owner;
    uint256 public immutable goal;
    uint256 public immutable deadline;

    uint256 public raised;
    bool public withdrawn;
    bool public withdrawalStarted;
    uint256 public withdrawalCursor;
    uint256 public withdrawnAmount;

    uint256[] private tokenIds;
    mapping(uint256 => bool) public tokenIdRegistered;
    uint256 private locked = 1;

    event ProjectFunded(
        bytes32 indexed projectId,
        address indexed contributor,
        uint256 indexed tokenId,
        uint256 amount
    );
    event ProjectWithdrawn(
        bytes32 indexed projectId,
        address indexed owner,
        uint256 amount,
        string note
    );
    event ProjectWithdrawalStarted(bytes32 indexed projectId, address indexed owner, string note);
    event ProjectWithdrawalBatch(
        bytes32 indexed projectId,
        address indexed owner,
        uint256 fromIndex,
        uint256 toIndex,
        uint256 amount
    );

    error OnlyHub();
    error NotProjectOwner();
    error FundingClosed();
    error GoalExceeded();
    error ZeroContribution();
    error ContributionTooSmall();
    error WithdrawNotAllowed();
    error AlreadyWithdrawn();
    error NoFunds();
    error InvalidProjectData();
    error NoteTooLong();
    error ReentrantCall();
    error BatchWithdrawalRequired();
    error SingleWithdrawalRequired();
    error InvalidBatchSize();

    modifier nonReentrant() {
        if (locked != 1) revert ReentrantCall();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address hub_, bytes32 projectId_, address owner_, uint256 goal_, uint256 deadline_) {
        hub = ICirclesHubV2(hub_);
        projectId = projectId_;
        owner = owner_;
        goal = goal_;
        deadline = deadline_;
    }

    function tokenIdsForProject() external view returns (uint256[] memory) {
        return tokenIds;
    }

    function usesBatchWithdrawal() public view returns (bool) {
        return goal >= BATCH_WITHDRAWAL_GOAL;
    }

    function withdraw(string calldata note) external nonReentrant {
        if (msg.sender != owner) revert NotProjectOwner();
        if (withdrawn) revert AlreadyWithdrawn();
        if (usesBatchWithdrawal()) revert BatchWithdrawalRequired();
        _validateWithdrawal(note);

        (uint256[] memory ids, uint256[] memory values, uint256 total) = _balancesForRange(0, tokenIds.length);
        if (ids.length == 0) revert NoFunds();

        withdrawalStarted = true;
        withdrawn = true;
        withdrawnAmount = total;
        hub.safeBatchTransferFrom(address(this), owner, ids, values, bytes(note));
        emit ProjectWithdrawn(projectId, owner, total, note);
    }

    function withdrawBatch(uint256 maxTokenIds, string calldata note) external nonReentrant {
        if (msg.sender != owner) revert NotProjectOwner();
        if (withdrawn) revert AlreadyWithdrawn();
        if (!usesBatchWithdrawal()) revert SingleWithdrawalRequired();
        if (maxTokenIds == 0 || maxTokenIds > MAX_BATCH_SIZE) revert InvalidBatchSize();
        _validateWithdrawal(note);

        uint256 fromIndex = withdrawalCursor;
        uint256 toIndex = fromIndex + maxTokenIds;
        if (toIndex > tokenIds.length) toIndex = tokenIds.length;

        if (!withdrawalStarted) {
            withdrawalStarted = true;
            emit ProjectWithdrawalStarted(projectId, owner, note);
        }

        (uint256[] memory ids, uint256[] memory values, uint256 total) = _balancesForRange(fromIndex, toIndex);
        withdrawalCursor = toIndex;
        withdrawnAmount += total;

        if (ids.length != 0) {
            hub.safeBatchTransferFrom(address(this), owner, ids, values, bytes(note));
        }
        emit ProjectWithdrawalBatch(projectId, owner, fromIndex, toIndex, total);

        if (toIndex == tokenIds.length) {
            if (withdrawnAmount == 0) revert NoFunds();
            withdrawn = true;
            emit ProjectWithdrawn(projectId, owner, withdrawnAmount, note);
        }
    }

    function _validateWithdrawal(string calldata note) private view {
        if (raised < goal && block.timestamp < deadline) revert WithdrawNotAllowed();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();
    }

    function _balancesForRange(uint256 fromIndex, uint256 toIndex)
        private
        view
        returns (uint256[] memory ids, uint256[] memory values, uint256 total)
    {
        uint256 payableTokenCount;
        for (uint256 i = fromIndex; i < toIndex; ++i) {
            uint256 balance = hub.balanceOf(address(this), tokenIds[i]);
            if (balance != 0) {
                ++payableTokenCount;
                total += balance;
            }
        }
        ids = new uint256[](payableTokenCount);
        values = new uint256[](payableTokenCount);
        uint256 outputIndex;

        for (uint256 i = fromIndex; i < toIndex; ++i) {
            uint256 tokenId = tokenIds[i];
            uint256 balance = hub.balanceOf(address(this), tokenId);
            if (balance != 0) {
                ids[outputIndex] = tokenId;
                values[outputIndex] = balance;
                ++outputIndex;
            }
        }
    }

    function onERC1155Received(
        address,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata
    ) external returns (bytes4) {
        if (msg.sender != address(hub)) revert OnlyHub();
        if (withdrawn || withdrawalStarted || block.timestamp >= deadline || raised >= goal) revert FundingClosed();
        if (value == 0) revert ZeroContribution();
        if (value > goal - raised) revert GoalExceeded();
        if (value < MIN_CONTRIBUTION && value != goal - raised) revert ContributionTooSmall();

        if (!tokenIdRegistered[id]) {
            tokenIdRegistered[id] = true;
            tokenIds.push(id);
        }

        raised += value;
        emit ProjectFunded(projectId, from, id, value);
        return IERC1155ReceiverV2.onERC1155Received.selector;
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
        return interfaceId == 0x01ffc9a7 || interfaceId == type(IERC1155ReceiverV2).interfaceId;
    }
}

contract FundedProjectEscrowV2 {
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant MAX_METADATA_URI_BYTES = 512;

    struct Project {
        address owner;
        address vault;
        uint256 goal;
        uint256 deadline;
        string metadataURI;
    }

    ICirclesHubV2 public immutable hub;
    mapping(bytes32 => Project) private projects;

    event ProjectCreated(
        bytes32 indexed projectId,
        address indexed owner,
        address indexed vault,
        uint256 goal,
        uint256 deadline,
        string metadataURI
    );

    error InvalidHub();
    error InvalidProjectId();
    error InvalidGoal();
    error InvalidDeadline();
    error InvalidMetadata();
    error ProjectAlreadyExists();
    error ProjectNotFound();

    constructor(address hub_) {
        if (hub_ == address(0) || hub_.code.length == 0) revert InvalidHub();
        hub = ICirclesHubV2(hub_);
    }

    function createProject(
        bytes32 projectId,
        uint256 goal,
        uint256 deadline,
        string calldata metadataURI
    ) external returns (address vault) {
        if (projectId == bytes32(0)) revert InvalidProjectId();
        if (projects[projectId].owner != address(0)) revert ProjectAlreadyExists();
        if (goal == 0) revert InvalidGoal();
        if (deadline < block.timestamp + MIN_DURATION || deadline > block.timestamp + MAX_DURATION) {
            revert InvalidDeadline();
        }

        uint256 metadataLength = bytes(metadataURI).length;
        if (metadataLength == 0 || metadataLength > MAX_METADATA_URI_BYTES) revert InvalidMetadata();

        vault = address(new FundedProjectVaultV2(address(hub), projectId, msg.sender, goal, deadline));
        projects[projectId] = Project({
            owner: msg.sender,
            vault: vault,
            goal: goal,
            deadline: deadline,
            metadataURI: metadataURI
        });

        emit ProjectCreated(projectId, msg.sender, vault, goal, deadline, metadataURI);
    }

    function getProject(bytes32 projectId) external view returns (Project memory project) {
        project = projects[projectId];
        if (project.owner == address(0)) revert ProjectNotFound();
    }
}
