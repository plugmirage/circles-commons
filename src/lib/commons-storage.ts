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

const MEMBERSHIP_REQUESTS_KEY = "circles-commons-membership-requests";
const SERVICES_KEY = "circles-commons-services";
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

function localServices(communityAddress?: string): StoredService[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SERVICES_KEY) ?? "{}") as Record<string, StoredService[]>;
    return stored[(communityAddress ?? "").toLowerCase()] ?? [];
  } catch {
    return [];
  }
}

function saveLocalService(communityAddress: string, service: StoredService) {
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

export async function publishProject(communityAddress: string | undefined, project: StoredProject) {
  if (!communityAddress) throw new Error("Choose a community before creating a project.");
  if (!supabaseUrl || !supabaseKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/projects`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      community_address: communityAddress.toLowerCase(),
      id: project.id,
      title: project.title,
      description: project.description,
      location: project.location,
      goal: project.goal,
      milestones: project.milestones
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
  if (!supabaseUrl || !supabaseKey) return defaults;
  let response = await fetch(
    `${supabaseUrl}/rest/v1/communities?select=address,name,description,kind,treasury_address,admin_address,source&order=created_at.asc`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) {
    response = await fetch(
      `${supabaseUrl}/rest/v1/communities?select=address,name,description&order=created_at.asc`,
      { headers: supabaseHeaders() }
    );
    if (!response.ok) throw new Error("Could not load communities.");
    const legacyRows = await response.json() as StoredCommunity[];
    return legacyRows.length > 0 ? legacyRows.map((row) => ({
      ...row,
      kind: "organization" as const,
      treasuryAddress: row.address,
      adminAddress: row.address,
      source: "created" as const
    })) : defaults;
  }
  const rows = await response.json() as (StoredCommunity & { treasury_address?: string; admin_address?: string })[];
  return rows.length > 0 ? rows.map((row) => ({
    address: row.address,
    name: row.name,
    description: row.description,
    kind: row.kind ?? "organization",
    treasuryAddress: row.treasury_address ?? row.treasuryAddress ?? row.address,
    adminAddress: row.admin_address ?? row.adminAddress ?? row.treasury_address ?? row.treasuryAddress ?? row.address,
    source: row.source ?? "created"
  })) : defaults;
}

export async function registerCommunityMetadata(community: StoredCommunity) {
  if (!supabaseUrl || !supabaseKey) return;
  const payload = {
    address: community.address.toLowerCase(),
    name: community.name,
    description: community.description,
    kind: community.kind ?? "organization",
    treasury_address: (community.treasuryAddress ?? community.address).toLowerCase(),
    admin_address: (community.adminAddress ?? community.treasuryAddress ?? community.address).toLowerCase(),
    source: community.source ?? "created"
  };
  let response = await fetch(`${supabaseUrl}/rest/v1/communities`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  if (response.ok) return;

  let responseBody = await response.text();
  if (isDuplicateInsert(response.status, responseBody)) return;

  const lowerBody = responseBody.toLowerCase();
  const couldBeLegacySchema =
    response.status === 400 &&
    (lowerBody.includes("kind") ||
      lowerBody.includes("treasury_address") ||
      lowerBody.includes("admin_address") ||
      lowerBody.includes("source"));

  if (couldBeLegacySchema) {
    response = await fetch(`${supabaseUrl}/rest/v1/communities`, {
      method: "POST",
      headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
      address: community.address.toLowerCase(),
      name: community.name,
        description: community.description
      })
    });
    if (response.ok) return;
    responseBody = await response.text();
    if (isDuplicateInsert(response.status, responseBody)) return;
  }

  throw new Error(
    `Organization metadata could not be saved in Supabase (${response.status}): ${responseBody || response.statusText}`
  );
}
