import { NextRequest, NextResponse } from "next/server";
import {
  createWalletClient,
  createPublicClient,
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

    console.log("RESOLVE STARTED:", {
      matchId: chain_match_id,
      winner: winnerAddress,
    });

    // Public client for waiting on tx confirmations
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

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

    let tx1: string | null = null;
    let tx2: string | null = null;
    let oracleError: string | null = null;

    // First call — Oracle registers the vote
    try {
      console.log("ORACLE ATTEMPTING:", {
        matchId: chain_match_id,
        winner: winnerAddress,
        from: oracleAccount.address,
      });

      tx1 = await oracleClient.writeContract({
        address: ESCROW_PROXY,
        abi: ESCROW_ABI,
        functionName: "resolveMatch",
        args: [matchId, winnerAddress],
      });

      console.log("ORACLE TX SUBMITTED:", tx1);

      // Wait for oracle tx to be confirmed before sentinel call
      if (tx1) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx1 as `0x${string}`,
          confirmations: 1,
        });
        console.log("ORACLE TX CONFIRMED:", {
          hash: tx1,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
        });
      }
    } catch (e) {
      oracleError = e instanceof Error ? e.message : String(e);
      console.log("ORACLE CALL FAILED (may have already voted):", oracleError);
    }

    // Second call — Sentinel confirms and triggers payout
    try {
      console.log("SENTINEL ATTEMPTING:", {
        matchId: chain_match_id,
        winner: winnerAddress,
        from: sentinelAccount.address,
        oracleTxHash: tx1,
      });

      tx2 = await sentinelClient.writeContract({
        address: ESCROW_PROXY,
        abi: ESCROW_ABI,
        functionName: "resolveMatch",
        args: [matchId, winnerAddress],
      });

      console.log("SENTINEL TX SUBMITTED:", tx2);

      // Wait for sentinel tx to be confirmed — this is the payout tx
      if (tx2) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx2 as `0x${string}`,
          confirmations: 1,
        });
        console.log("SENTINEL TX CONFIRMED:", {
          hash: tx2,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
        });

        // If the tx was included but reverted, surface that as a failure
        if (receipt.status !== "success") {
          return NextResponse.json(
            {
              error: "Sentinel tx reverted on-chain",
              tx_hash_oracle: tx1,
              tx_hash_sentinel: tx2,
              oracle_error: oracleError,
            },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("SENTINEL FAILED:", msg);
      return NextResponse.json(
        {
          error: "Sentinel call failed",
          details: msg,
          tx_hash_oracle: tx1,
          oracle_error: oracleError,
        },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    if (!tx1 && !tx2) {
      return NextResponse.json(
        {
          error: "Both resolve calls failed - match may already be resolved",
          oracle_error: oracleError,
        },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    console.log("RESOLVE SUCCESS:", {
      matchId: chain_match_id,
      tx_hash_oracle: tx1,
      tx_hash_sentinel: tx2,
    });

    return NextResponse.json(
      {
        success: true,
        tx_hash_oracle: tx1,
        tx_hash_sentinel: tx2,
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
