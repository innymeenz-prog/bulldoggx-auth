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
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    const apiSecret = process.env.RESOLVE_API_SECRET;

    if (!privateKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing ADMIN_PRIVATE_KEY" },
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

    const account = privateKeyToAccount(privateKey as Hex);

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    const matchId = BigInt(chain_match_id);
    let tx1: string | null = null;
    let tx2: string | null = null;

    // First call — registers the vote
    try {
      tx1 = await walletClient.writeContract({
        address: ESCROW_PROXY,
        abi: ESCROW_ABI,
        functionName: "resolveMatch",
        args: [matchId, winnerAddress],
      });
    } catch {
      // Vote may already be registered, continue to second call
    }

    // Second call — triggers payout
    try {
      tx2 = await walletClient.writeContract({
        address: ESCROW_PROXY,
        abi: ESCROW_ABI,
        functionName: "resolveMatch",
        args: [matchId, winnerAddress],
      });
    } catch {
      // If both fail, match may already be resolved
    }

    if (!tx1 && !tx2) {
      return NextResponse.json(
        { error: "Both resolve calls failed - match may already be resolved" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        tx_hash_1: tx1,
        tx_hash_2: tx2,
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
