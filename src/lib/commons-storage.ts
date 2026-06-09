export type MembershipRequest = {
  address: string;
  requestedAt: string;
};
export type StoredProject = {
  id: string;
  title: string;
  description: string;
  location: string;
  goal: number;
  milestones: { amount: number; label: string }[];
  ownerAddress?: string;
  deadline?: string;
  status?: "open" | "withdrawn";
  withdrawNote?: string;
  contractVersion?: "v1" | "v2";
  vaultAddress?: string;
};
export type StoredService = {
  id: string;
  title: string;
  description: string;
  provider: string;
  providerAddress: string;
  duration: string;
  price: number;
};
export type StoredCommunity = {
  address: string;
  name: string;
  description: string;
  kind?: "organization" | "group";
  treasuryAddress?: string;
  adminAddress?: string;
  source?: "created" | "activated";
};
export type ReferralMetrics = {
  wallets: number;
  inviteSources: number;
};

const MEMBERSHIP_REQUESTS_KEY = "circles-commons-membership-requests";
const SERVICES_KEY = "circles-commons-services";
const LEGACY_COMMUNITIES_KEY = "circles-commons-communities";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function canUseLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function localRequests(): MembershipRequest[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MEMBERSHIP_REQUESTS_KEY) ?? "[]") as
      | MembershipRequest[]
      | string[];
    return stored.map((request) =>
      typeof request === "string"
        ? { address: request, requestedAt: new Date().toISOString() }
        : request
    );
  } catch {
    return [];
  }
}

function saveLocalRequests(requests: MembershipRequest[]) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(MEMBERSHIP_REQUESTS_KEY, JSON.stringify(requests));
}

function mergeCommunities(...lists: StoredCommunity[][]) {
  const merged = new Map<string, StoredCommunity>();
  for (const community of lists.flat()) {
    if (!community.address) continue;
    const address = community.address.toLowerCase();
    merged.set(address, {
      ...community,
      address,
      kind: community.kind ?? "organization",
      treasuryAddress: (community.treasuryAddress ?? community.address).toLowerCase(),
      adminAddress: (community.adminAddress ?? community.treasuryAddress ?? community.address).toLowerCase(),
      source: community.source ?? "created"
    });
  }
  return [...merged.values()];
}

function clearLegacyLocalCommunities() {
  if (!canUseLocalStorage()) return;
  window.localStorage.removeItem(LEGACY_COMMUNITIES_KEY);
}

function localServices(communityAddress?: string): StoredService[] {
  if (!canUseLocalStorage()) return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(SERVICES_KEY) ?? "{}") as Record<string, StoredService[]>;
    return stored[(communityAddress ?? "").toLowerCase()] ?? [];
  } catch {
    return [];
  }
}

function saveLocalService(communityAddress: string, service: StoredService) {
  if (!canUseLocalStorage()) return;
  const normalizedCommunity = communityAddress.toLowerCase();
  const stored = JSON.parse(window.localStorage.getItem(SERVICES_KEY) ?? "{}") as Record<string, StoredService[]>;
  const current = stored[normalizedCommunity] ?? [];
  stored[normalizedCommunity] = [service, ...current.filter((item) => item.id !== service.id)];
  window.localStorage.setItem(SERVICES_KEY, JSON.stringify(stored));
}

function supabaseHeaders() {
  return {
    apikey: supabaseKey!,
    Authorization: `Bearer ${supabaseKey!}`,
    "Content-Type": "application/json"
  };
}

function isDuplicateInsert(status: number, body: string) {
  return status === 409 || body.toLowerCase().includes("duplicate key");
}

export async function loadMembershipRequests(communityAddress?: string): Promise<MembershipRequest[]> {
  if (!supabaseUrl || !supabaseKey || !communityAddress) return localRequests();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/membership_requests?community_address=eq.${communityAddress.toLowerCase()}&status=eq.pending&select=member_address,requested_at`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error("Could not load membership requests.");
  const rows = await response.json() as { member_address: string; requested_at: string }[];
  return rows.map((row) => ({ address: row.member_address, requestedAt: row.requested_at }));
}

export async function requestMembership(communityAddress: string | undefined, address: string) {
  const request = { address, requestedAt: new Date().toISOString() };
  if (!supabaseUrl || !supabaseKey || !communityAddress) {
    const current = localRequests();
    if (!current.some((item) => item.address.toLowerCase() === address.toLowerCase())) {
      saveLocalRequests([...current, request]);
    }
    return;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/membership_requests`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      community_address: communityAddress.toLowerCase(),
      member_address: address.toLowerCase(),
      status: "pending"
    })
  });
  if (!response.ok) throw new Error("Could not submit membership request.");
}

export async function removeMembershipRequest(communityAddress: string | undefined, address: string) {
  if (!supabaseUrl || !supabaseKey || !communityAddress) {
    saveLocalRequests(localRequests().filter((item) => item.address.toLowerCase() !== address.toLowerCase()));
    return true;
  }
  // Shared requests stay in the database. The UI resolves approval from Circles on-chain trust.
  return false;
}

export async function loadProjects(communityAddress: string | undefined, defaults: StoredProject[]) {
  if (!supabaseUrl || !supabaseKey) return defaults;
  let response = await fetch(
    `${supabaseUrl}/rest/v1/projects?select=id,title,description,location,goal,milestones,owner_address,deadline,status,withdraw_note,contract_version,vault_address&order=created_at.desc`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) {
    response = await fetch(
      `${supabaseUrl}/rest/v1/projects?select=id,title,description,location,goal,milestones,owner_address,deadline,status,withdraw_note&order=created_at.desc`,
      { headers: supabaseHeaders() }
    );
  }
  if (!response.ok && communityAddress) {
    response = await fetch(
      `${supabaseUrl}/rest/v1/projects?community_address=eq.${communityAddress.toLowerCase()}&select=id,title,description,location,goal,milestones`,
      { headers: supabaseHeaders() }
    );
  }
  if (!response.ok) throw new Error("Could not load funded projects.");
  const rows = await response.json() as (StoredProject & { owner_address?: string; withdraw_note?: string; contract_version?: "v1" | "v2"; vault_address?: string })[];
  const mapped = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    goal: Number(row.goal),
    milestones: row.milestones,
    ownerAddress: row.owner_address ?? row.ownerAddress,
    deadline: row.deadline,
    status: row.status ?? "open",
    withdrawNote: row.withdraw_note ?? row.withdrawNote,
    contractVersion: row.contract_version ?? row.contractVersion ?? "v1",
    vaultAddress: row.vault_address ?? row.vaultAddress
  }));
  return mapped.length > 0 ? mapped : defaults;
}

export async function publishProject(communityAddress: string | undefined, project: StoredProject) {
  if (!project.ownerAddress) throw new Error("Connect your Gnosis App wallet before creating a project.");
  if (!supabaseUrl || !supabaseKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/projects`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      community_address: (communityAddress || "global").toLowerCase(),
      id: project.id,
      title: project.title,
      description: project.description,
      location: project.location,
      goal: project.goal,
      milestones: project.milestones,
      owner_address: project.ownerAddress.toLowerCase(),
      deadline: project.deadline,
      status: project.status ?? "open",
      contract_version: project.contractVersion ?? "v1",
      vault_address: project.vaultAddress ?? null
    })
  });
  if (!response.ok) {
    const responseBody = await response.text();
    if (isDuplicateInsert(response.status, responseBody)) return;
    throw new Error(
      `Project could not be saved in Supabase (${response.status}): ${responseBody || response.statusText}`
    );
  }
}

export async function markProjectWithdrawn(projectId: string, note: string) {
  if (!supabaseUrl || !supabaseKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/projects?id=eq.${projectId}`, {
    method: "PATCH",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "withdrawn",
      withdraw_note: note
    })
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Project withdrawal could not be saved in Supabase (${response.status}): ${responseBody || response.statusText}`);
  }
}

export async function trackReferralVisit(ref: string, walletAddress: string, projectId?: string | null) {
  if (!supabaseUrl || !supabaseKey || !ref.trim() || !walletAddress.trim()) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/referral_visits`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      ref: ref.trim().slice(0, 160),
      wallet_address: walletAddress.toLowerCase(),
      project_id: projectId?.trim() || null
    })
  });
  if (!response.ok && response.status !== 409) {
    throw new Error("Could not track referral visit.");
  }
}

export async function loadReferralMetrics(): Promise<ReferralMetrics> {
  const empty = { wallets: 0, inviteSources: 0 };
  if (!supabaseUrl || !supabaseKey) return empty;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/referral_visits?select=ref,wallet_address,project_id&limit=500`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) return empty;
  const rows = await response.json() as { ref: string; wallet_address: string; project_id: string | null }[];
  const trackedRows = rows.filter((row) => !row.ref.startsWith("debug:"));
  return {
    wallets: new Set(trackedRows.map((row) => row.wallet_address.toLowerCase())).size,
    inviteSources: new Set(trackedRows.map((row) => row.ref).filter((ref) => ref !== "commons")).size
  };
}

export async function trackWebsiteVisit() {
  if (!supabaseUrl || !supabaseKey || typeof window === "undefined") return;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
  const response = await fetch(`${supabaseUrl}/rest/v1/website_visits`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ path: window.location.pathname.slice(0, 500) || "/" })
  });
  if (!response.ok) throw new Error("Could not track website visit.");
}

export async function loadWebsiteVisitCount(): Promise<number> {
  if (!supabaseUrl || !supabaseKey) return 0;
  const response = await fetch(`${supabaseUrl}/rest/v1/website_visits?select=id`, {
    method: "HEAD",
    headers: { ...supabaseHeaders(), Prefer: "count=exact", Range: "0-0" }
  });
  if (!response.ok) return 0;
  const contentRange = response.headers.get("content-range");
  const count = contentRange?.split("/")[1];
  return count && count !== "*" ? Number(count) : 0;
}

export async function loadServices(communityAddress: string | undefined): Promise<StoredService[]> {
  if (!supabaseUrl || !supabaseKey || !communityAddress) return localServices(communityAddress);
  const normalizedCommunity = communityAddress.toLowerCase();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/services?community_address=eq.${normalizedCommunity}&status=eq.active&select=id,title,description,provider,provider_address,duration,price&order=created_at.desc`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) return localServices(communityAddress);
  const rows = await response.json() as {
    id: string;
    title: string;
    description: string;
    provider: string;
    provider_address: string;
    duration: string;
    price: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    provider: row.provider,
    providerAddress: row.provider_address,
    duration: row.duration,
    price: Number(row.price)
  }));
}

export async function publishService(communityAddress: string | undefined, service: StoredService) {
  if (!communityAddress) throw new Error("Choose a community before publishing a service.");
  if (!supabaseUrl || !supabaseKey) {
    saveLocalService(communityAddress, service);
    return;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/services`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      community_address: communityAddress.toLowerCase(),
      id: service.id,
      title: service.title,
      description: service.description,
      provider: service.provider,
      provider_address: service.providerAddress.toLowerCase(),
      duration: service.duration,
      price: service.price,
      status: "active"
    })
  });
  if (!response.ok) throw new Error("Could not publish this service.");
}

export async function loadCommunities(defaults: StoredCommunity[]) {
  clearLegacyLocalCommunities();
  const response = await fetch("/api/communities", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load communities from the shared database.");
  const rows = await response.json() as (StoredCommunity & { treasury_address?: string; admin_address?: string })[];
  const stored = rows.map((row) => ({
    address: row.address,
    name: row.name,
    description: row.description,
    kind: row.kind ?? "organization",
    treasuryAddress: row.treasury_address ?? row.treasuryAddress ?? row.address,
    adminAddress: row.admin_address ?? row.adminAddress ?? row.treasury_address ?? row.treasuryAddress ?? row.address,
    source: row.source ?? "created"
  }));
  return mergeCommunities(defaults, stored);
}

export async function registerCommunityMetadata(community: StoredCommunity) {
  const payload = {
    address: community.address.toLowerCase(),
    name: community.name,
    description: community.description,
    kind: community.kind ?? "organization",
    treasury_address: (community.treasuryAddress ?? community.address).toLowerCase(),
    admin_address: (community.adminAddress ?? community.treasuryAddress ?? community.address).toLowerCase(),
    source: community.source ?? "created"
  };
  const response = await fetch("/api/communities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (response.ok) return;

  const responseBody = await response.text();
  if (isDuplicateInsert(response.status, responseBody)) {
    throw new Error(
      "This Organization address is already registered in the shared database. Connect a different wallet or choose the existing Organization."
    );
  }
  try {
    const parsed = JSON.parse(responseBody) as { error?: string };
    throw new Error(
      `Organization metadata could not be saved in Supabase (${response.status}): ${parsed.error || response.statusText}`
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Organization metadata could not be saved in Supabase (${response.status}): ${responseBody || response.statusText}`
      );
    }
    throw error;
  }
}
