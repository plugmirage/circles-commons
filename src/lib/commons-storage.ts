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
};
export type StoredCommunity = {
  address: string;
  name: string;
  description: string;
};

const MEMBERSHIP_REQUESTS_KEY = "circles-commons-membership-requests";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
  window.localStorage.setItem(MEMBERSHIP_REQUESTS_KEY, JSON.stringify(requests));
}

function supabaseHeaders() {
  return {
    apikey: supabaseKey!,
    "Content-Type": "application/json"
  };
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
  if (!supabaseUrl || !supabaseKey || !communityAddress) return defaults;
  const normalizedCommunity = communityAddress.toLowerCase();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/projects?community_address=eq.${normalizedCommunity}&select=id,title,description,location,goal,milestones`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error("Could not load community projects.");
  const rows = await response.json() as StoredProject[];
  return rows.length > 0 ? rows : defaults;
}

export async function loadCommunities(defaults: StoredCommunity[]) {
  if (!supabaseUrl || !supabaseKey) return defaults;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/communities?select=address,name,description&order=created_at.asc`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error("Could not load communities.");
  const rows = await response.json() as StoredCommunity[];
  return rows.length > 0 ? rows : defaults;
}

export async function registerCommunityMetadata(community: StoredCommunity) {
  if (!supabaseUrl || !supabaseKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/communities`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ ...community, address: community.address.toLowerCase() })
  });
  if (!response.ok) throw new Error("Organization created, but community metadata could not be published.");
}
