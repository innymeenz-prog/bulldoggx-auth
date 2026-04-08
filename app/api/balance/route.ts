import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits, isAddress } from "viem";
import { baseSepolia } from "viem/chains";

// BGX token contract on Base Sepolia
const BGX_CONTRACT = "0x958BdE531dB5E9E566cb3690D65f8bE7693E9D22";

// Minimal ERC-20 ABI - just the functions we need
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// CORS headers so Bubble can call this endpoint
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet");

    if (!wallet) {
      return NextResponse.json(
        { error: "Missing wallet parameter" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!isAddress(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400, headers: corsHeaders }
      );
    }

    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const [bgxRaw, ethRaw, decimals] = await Promise.all([
      client.readContract({
        address: BGX_CONTRACT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      }),
      client.getBalance({ address: wallet as `0x${string}` }),
      client.readContract({
        address: BGX_CONTRACT,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);

    const bgxBalance = formatUnits(bgxRaw, decimals);
    const ethBalance = formatUnits(ethRaw, 18);

    return NextResponse.json(
      {
        wallet: wallet,
        bgx_balance: bgxBalance,
        bgx_balance_raw: bgxRaw.toString(),
        eth_balance: ethBalance,
        eth_balance_raw: ethRaw.toString(),
        chain: "base-sepolia",
        chain_id: 84532,
      },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: "Failed to fetch balance", details: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
