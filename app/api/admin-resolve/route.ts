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
  "function adminResolve(uint256 matchId, address winner) external",
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
    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    const apiSecret = process.env.RESOLVE_API_SECRET;

    if (!adminKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing admin key" },
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

    console.log("ADMIN RESOLVE STARTED:", {
      matchId: chain_match_id,
      winner: winnerAddress,
    });

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const adminAccount = privateKeyToAccount(adminKey as Hex);
    const adminClient = createWalletClient({
      account: adminAccount,
      chain: baseSepolia,
      transport: http(),
    });

    let txHash: string | null = null;

    try {
      console.log("ADMIN ATTEMPTING:", {
        matchId: chain_match_id,
        winner: winnerAddress,
        from: adminAccount.address,
      });

      txHash = await adminClient.writeContract({
        address: ESCROW_PROXY,
        abi: ESCROW_ABI,
        functionName: "adminResolve",
        args: [matchId, winnerAddress],
      });

      console.log("ADMIN TX SUBMITTED:", txHash);

      if (txHash) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          confirmations: 1,
        });

        console.log("ADMIN TX CONFIRMED:", {
          hash: txHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
        });

        if (receipt.status !== "success") {
          return NextResponse.json(
            {
              error: "Admin resolve tx reverted on-chain",
              tx_hash: txHash,
            },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("ADMIN RESOLVE FAILED:", msg);
      return NextResponse.json(
        {
          error: "Admin resolve call failed",
          details: msg,
        },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    console.log("ADMIN RESOLVE SUCCESS:", {
      matchId: chain_match_id,
      tx_hash: txHash,
    });

    return NextResponse.json(
      {
        success: true,
        tx_hash: txHash,
        chain_match_id,
        winner_wallet: winnerAddress,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error: unknown) {
    console.error("adminResolve failed:", error);

    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { error: "Transaction failed", details: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
