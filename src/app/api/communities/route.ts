import { NextResponse } from "next/server";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers() {
  return {
    apikey: supabaseKey!,
    Authorization: `Bearer ${supabaseKey!}`,
    "Content-Type": "application/json"
  };
}

function missingConfigResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on the server." },
    { status: 500 }
  );
}

export async function GET() {
  if (!supabaseUrl || !supabaseKey) return missingConfigResponse();

  const response = await fetch(
    `${supabaseUrl}/rest/v1/communities?select=address,name,description,kind,treasury_address,admin_address,source&order=created_at.asc`,
    { headers: headers(), cache: "no-store" }
  );
  const body = await response.text();

  if (!response.ok) {
    return NextResponse.json(
      { error: body || response.statusText },
      { status: response.status }
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseKey) return missingConfigResponse();

  const payload = await request.json();
  console.info("[communities] create request", {
    address: payload?.address,
    name: payload?.name,
    treasury_address: payload?.treasury_address,
    admin_address: payload?.admin_address
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/communities`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  if (!response.ok) {
    console.error("[communities] create failed", {
      status: response.status,
      address: payload?.address,
      name: payload?.name,
      body
    });
    return NextResponse.json(
      { error: body || response.statusText },
      { status: response.status }
    );
  }

  console.info("[communities] create saved", {
    address: payload?.address,
    name: payload?.name
  });
  return NextResponse.json({ ok: true });
}
