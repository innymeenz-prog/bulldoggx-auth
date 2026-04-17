import { NextRequest, NextResponse } from "next/server";
import {
  createWalletClient,
  http,
  parseAbi,
  getAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ESCROW_PROXY = "0xEAF4996ca75c2F2Db3c7695e41f1fA199Fd803A0";

const ESCROW_ABI = parseAbi([
  "function resolveMatch(uint256 matchId, address winner) external",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const oracleKey = process.env.ADMIN_PRIVATE_KEY;
    const sentinelKey = process.env.SENTINEL_PRIVATE_KEY;
    const apiSecret = process.env.RESOLVE_API_SECRET;

    if (!oracleKey || !sentinelKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing signer keys" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (apiSecret && authHeader !== `Bearer ${apiSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const body = await req.json();
    const { chain_match_id, winner_wallet } = body;

    if (!chain_match_id || !winner_wallet) {
      return NextResponse.json(
        { error: "Missing chain_match_id or winner_wallet" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    let winnerAddress: `0x${string}`;
    try {
      winnerAddress = getAddress(winner_wallet);
    } catch {
      return NextResponse.json(
        { error: "Invalid winner_wallet address" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const matchId = BigInt(chain_match_id);

    // Signer 1 — Oracle/Admin
    const oracleAccount = privateKeyToAccount(oracleKey as Hex);
    const oracleClient = createWalletClient({
      account: oracleAccount,
      chain: baseSepolia,
      transport: http(),
    });

    // Signer 2 — Sentinel (different address)
    const sentinelAccount = privateKeyToAccount(sentinelKey as Hex);
    const sentinelClient = createWalletClient({
      account: sentinelAccount,
      chain: baseSepolia,
      transport: http(),
    });

    // First call — Oracle registers the vote
    const tx1 = await oracleClient.writeContract({
      address: ESCROW_PROXY,
      abi: ESCROW_ABI,
      functionName: "resolveMatch",
      args: [matchId, winnerAddress],
    });

    // Second call — Sentinel confirms and triggers payout
    const tx2 = await sentinelClient.writeContract({
      address: ESCROW_PROXY,
      abi: ESCROW_ABI,
      functionName: "resolveMatch",
      args: [matchId, winnerAddress],
    });

    return NextResponse.json(
      {
        success: true,
        tx_hash_vote: tx1,
        tx_hash_payout: tx2,
        chain_match_id,
        winner_wallet: winnerAddress,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error: unknown) {
    console.error("resolveMatch failed:", error);

    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { error: "Transaction failed", details: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
