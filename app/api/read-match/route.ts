// app/api/read-match/route.ts
//
// Diagnostic endpoint — reads on-chain state for a given matchId and verifies
// contract roles. No gas spent, no signers used. Call it like:
//
//   GET  /api/read-match?matchId=49
//   POST /api/read-match  { "chain_match_id": 49 }
//
// Bearer auth uses the same RESOLVE_API_SECRET as other routes.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { baseSepolia } from "viem/chains";

const ESCROW_PROXY = "0xEAF4996ca75c2F2Db3c7695e41f1fA199Fd803A0" as const;

// Expected role holders (from env, with fallback to the known addresses from the
// handoff doc so we can compare even if env vars aren't set in the read path).
const EXPECTED_ORACLE   = "0x6c9a4b438EC17AF999bA616F8Ea2Ee085d28F69A";
const EXPECTED_SENTINEL = "0x0B8F0fb8E330CF2F9d760FC3F549f20C8A6c19C8";
const EXPECTED_ADMIN    = "0x6c9a4b438EC17AF999bA616F8Ea2Ee085d28F69A";

// Candidate ABI shapes for the matches(uint256) view function. The upgraded
// contract may have added fields — we try each shape and report which one
// decodes cleanly.
const ABI_CANDIDATES = [
  {
    label: "v1_minimal",
    abi: parseAbi([
      "function matches(uint256) view returns (address player1, address player2, uint256 stakeAmount, uint8 status, address winner)",
    ]),
  },
  {
    label: "v2_with_votes",
    abi: parseAbi([
      "function matches(uint256) view returns (address player1, address player2, uint256 stakeAmount, uint8 status, address winner, address oracleVote, address sentinelVote)",
    ]),
  },
  {
    label: "v3_with_timestamps",
    abi: parseAbi([
      "function matches(uint256) view returns (address player1, address player2, uint256 stakeAmount, uint8 status, address winner, address oracleVote, address sentinelVote, uint256 createdAt, uint256 resolvedAt)",
    ]),
  },
];

const ROLE_ABI = parseAbi([
  "function oracle() view returns (address)",
  "function sentinel() view returns (address)",
  "function admin() view returns (address)",
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
  "function matchCount() view returns (uint256)",
]);

const STATUS_LABELS = ["Created", "Active", "PendingResolve", "Disputed", "Completed"];

function bearerOk(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.RESOLVE_API_SECRET}`;
  return auth === expected;
}

function addrEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

async function readMatchId(req: NextRequest): Promise<number | null> {
  // Support both GET ?matchId= and POST { chain_match_id }
  const url = new URL(req.url);
  const qp = url.searchParams.get("matchId") || url.searchParams.get("chain_match_id");
  if (qp) return Number(qp);

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.chain_match_id !== undefined) return Number(body.chain_match_id);
      if (body?.matchId !== undefined) return Number(body.matchId);
    } catch {
      // no body
    }
  }
  return null;
}

async function handle(req: NextRequest) {
  if (!bearerOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const matchId = await readMatchId(req);

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.RPC_URL || "https://sepolia.base.org"),
  });

  const result: Record<string, unknown> = {
    escrow_proxy: ESCROW_PROXY,
    chain: "base-sepolia (84532)",
    match_id: matchId,
  };

  // ---- Role checks -------------------------------------------------------
  const roles: Record<string, unknown> = {};
  for (const fn of ["oracle", "sentinel", "admin", "owner", "treasury"] as const) {
    try {
      const addr = await client.readContract({
        address: ESCROW_PROXY,
        abi: ROLE_ABI,
        functionName: fn,
      }) as string;
      roles[fn] = addr;
    } catch (e: unknown) {
      roles[fn] = { error: (e as Error).message };
    }
  }

  // Compare
  roles.oracle_matches_expected   = addrEq(roles.oracle as string,   EXPECTED_ORACLE);
  roles.sentinel_matches_expected = addrEq(roles.sentinel as string, EXPECTED_SENTINEL);
  roles.admin_matches_expected    = addrEq(roles.admin as string,    EXPECTED_ADMIN);
  result.roles = roles;

  // ---- Paused? -----------------------------------------------------------
  try {
    const paused = await client.readContract({
      address: ESCROW_PROXY,
      abi: ROLE_ABI,
      functionName: "paused",
    });
    result.paused = paused;
  } catch (e: unknown) {
    result.paused = { error: (e as Error).message, note: "contract may not have paused() — that's fine" };
  }

  // ---- Match count -------------------------------------------------------
  try {
    const count = await client.readContract({
      address: ESCROW_PROXY,
      abi: ROLE_ABI,
      functionName: "matchCount",
    });
    result.match_count = String(count);
  } catch (e: unknown) {
    result.match_count = { error: (e as Error).message, note: "contract may not expose matchCount()" };
  }

  // ---- Match state -------------------------------------------------------
  if (matchId !== null && !Number.isNaN(matchId)) {
    const attempts: Record<string, unknown> = {};
    let decoded: Record<string, unknown> | null = null;

    for (const candidate of ABI_CANDIDATES) {
      try {
        const raw = await client.readContract({
          address: ESCROW_PROXY,
          abi: candidate.abi,
          functionName: "matches",
          args: [BigInt(matchId)],
        }) as readonly unknown[];

        // Shape it into an object using the candidate's named outputs
        const outputs = candidate.abi[0].outputs;
        const obj: Record<string, unknown> = {};
        outputs.forEach((o: { name?: string }, i: number) => {
          const key = o.name || `_${i}`;
          const val = raw[i];
          obj[key] = typeof val === "bigint" ? String(val) : val;
        });

        // Add human-readable status
        if (typeof obj.status === "number" || typeof obj.status === "bigint") {
          const s = Number(obj.status);
          obj.status_label = STATUS_LABELS[s] ?? `Unknown(${s})`;
        }

        attempts[candidate.label] = { ok: true, data: obj };
        if (!decoded) decoded = obj;
      } catch (e: unknown) {
        attempts[candidate.label] = { ok: false, error: (e as Error).message };
      }
    }

    result.match_read_attempts = attempts;
    result.match_decoded = decoded;
    result.match_decoded_hint = decoded
      ? "Use match_decoded for your answer. If multiple candidates decoded, the smallest-matching one is shown."
      : "All ABI candidates failed to decode — contract struct shape has changed. Get the updated ABI from the web3 dev.";
  } else {
    result.match_read_attempts = "no matchId provided — pass ?matchId=49 or POST { chain_match_id: 49 }";
  }

  // ---- Expected vs actual summary ---------------------------------------
  result.summary = {
    oracle_ok:   roles.oracle_matches_expected,
    sentinel_ok: roles.sentinel_matches_expected,
    admin_ok:    roles.admin_matches_expected,
    any_abi_decoded: result.match_decoded !== null && result.match_decoded !== undefined,
  };

  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
