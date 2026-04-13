"use client";

import { useEffect, useState, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { createPublicClient, http, encodeFunctionData, parseUnits, decodeEventLog } from "viem";
import { baseSepolia } from "viem/chains";

const BGX_CONTRACT = "0x958BdE531dB5E9E566cb3690D65f8bE7693E9D22";
const ESCROW_CONTRACT = "0xEAF4996ca75c2F2Db3c7695e41f1fA199Fd803A0";

const BGX_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ESCROW_ABI = [
  {
    inputs: [
      { name: "opponent", type: "address" },
      { name: "stakeAmount", type: "uint256" },
    ],
    name: "createMatch",
    outputs: [{ name: "matchId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "matchId", type: "uint256" }],
    name: "joinMatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "matchId", type: "uint256" },
      { indexed: true, name: "playerA", type: "address" },
      { indexed: true, name: "playerB", type: "address" },
      { indexed: false, name: "stake", type: "uint256" },
    ],
    name: "MatchCreated",
    type: "event",
  },
] as const;

export default function SignPage() {
  const { ready, authenticated, user } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const hasExecuted = useRef(false);

  const getQueryParam = (name: string): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get(name);
  };

  useEffect(() => {
    if (!ready) {
      setStatus("Initializing...");
      return;
    }
    if (!authenticated || !user) {
      setStatus("Not signed in. Redirecting...");
      const returnUrl = getQueryParam("return") || "https://bulldoggx.com/version-test";
      setTimeout(() => { window.location.href = returnUrl; }, 1500);
      return;
    }
    if (!smartWalletClient) {
      setStatus("Preparing wallet...");
      return;
    }
    if (hasExecuted.current) return;

    const action = getQueryParam("action");
    const returnUrl = getQueryParam("return") || "https://bulldoggx.com/version-test";

    if (!action) {
      setError("No action specified");
      return;
    }

    hasExecuted.current = true;

    const executeTransaction = async () => {
      try {
        if (action === "createMatch") {
          await handleCreateMatch(returnUrl);
        } else if (action === "joinMatch") {
          await handleJoinMatch(returnUrl);
        } else {
          setError(`Unknown action: ${action}`);
          hasExecuted.current = false;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Transaction failed";
        setError(message);
        hasExecuted.current = false;
      }
    };

    executeTransaction();
  }, [ready, authenticated, user, smartWalletClient]);

  const handleCreateMatch = async (returnUrl: string) => {
    const opponent = getQueryParam("opponent");
    const stake = getQueryParam("stake");
    const matchRowId = getQueryParam("match_id");

    if (!opponent || !stake) {
      setError("Missing opponent or stake parameter");
      return;
    }

    const stakeAmount = parseUnits(stake, 18);

    if (!smartWalletClient) throw new Error("Smart wallet not ready");

    // Step 1: Approve BGX spending
    setStatus("Step 1/2: Approving BGX...");

    const approveData = encodeFunctionData({
      abi: BGX_ABI,
      functionName: "approve",
      args: [ESCROW_CONTRACT as `0x${string}`, stakeAmount],
    });

    await smartWalletClient.sendTransaction({
      account: smartWalletClient.account,
      chain: baseSepolia,
      to: BGX_CONTRACT as `0x${string}`,
      data: approveData,
    });

    // Step 2: Create the match
    setStatus("Step 2/2: Creating match...");

    const createMatchData = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "createMatch",
      args: [opponent as `0x${string}`, stakeAmount],
    });

    const txHash = await smartWalletClient.sendTransaction({
      account: smartWalletClient.account,
      chain: baseSepolia,
      to: ESCROW_CONTRACT as `0x${string}`,
      data: createMatchData,
    });

    // Step 3: Wait for receipt and extract chain_match_id from MatchCreated event
    setStatus("Confirming on-chain...");

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let chainMatchId: string | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ESCROW_CONTRACT.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "MatchCreated") {
          chainMatchId = (decoded.args as { matchId: bigint }).matchId.toString();
          break;
        }
      } catch {
        // not our event, skip
      }
    }

    if (!chainMatchId) {
      setError("Transaction confirmed but could not extract matchId from receipt");
      return;
    }

    setStatus("Success! Redirecting...");

    const params = new URLSearchParams({
      view: "PlayerQueue",
      tx_hash: txHash,
      tx_status: "success",
      tx_action: "createMatch",
      chain_match_id: chainMatchId,
    });
    if (matchRowId) params.set("match_id", matchRowId);

    window.location.href = `${returnUrl}?${params.toString()}`;
  };

  const handleJoinMatch = async (returnUrl: string) => {
    const matchId = getQueryParam("match_id");
    const stake = getQueryParam("stake");
    const chainMatchId = getQueryParam("chain_match_id");

    if (!stake) {
      setError("Missing stake parameter");
      return;
    }

    const stakeAmount = parseUnits(stake, 18);

    if (!smartWalletClient) throw new Error("Smart wallet not ready");

    // Step 1: Approve BGX spending
    setStatus("Step 1/2: Approving BGX...");

    const approveData = encodeFunctionData({
      abi: BGX_ABI,
      functionName: "approve",
      args: [ESCROW_CONTRACT as `0x${string}`, stakeAmount],
    });

    await smartWalletClient.sendTransaction({
      account: smartWalletClient.account,
      chain: baseSepolia,
      to: BGX_CONTRACT as `0x${string}`,
      data: approveData,
    });

    // Step 2: Join the match
    setStatus("Step 2/2: Joining match...");

    if (!chainMatchId) {
      setError("Missing chain_match_id for joinMatch");
      return;
    }

    const joinMatchData = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "joinMatch",
      args: [BigInt(chainMatchId)],
    });

    const txHash = await smartWalletClient.sendTransaction({
      account: smartWalletClient.account,
      chain: baseSepolia,
      to: ESCROW_CONTRACT as `0x${string}`,
      data: joinMatchData,
    });

    setStatus("Success! Redirecting...");

    const params = new URLSearchParams({
      view: "PlayerQueue",
      tx_hash: txHash,
      tx_status: "success",
      tx_action: "joinMatch",
    });
    if (matchId) params.set("match_id", matchId);

    window.location.href = `${returnUrl}?${params.toString()}`;
  };

  return (
    <main style={{
      minHeight: "100vh", background: "#1a1d23", color: "#ffffff",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: "2rem",
    }}>
      <div style={{ fontSize: "2.5rem", fontWeight: 900, letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
        BULLDOG<span style={{ color: "#29b6f6" }}>GX</span>
      </div>
      <div style={{ fontSize: "0.75rem", letterSpacing: "0.2em", color: "#8a8f99", marginBottom: "3rem" }}>
        GAMERS. BEST. FRIEND.
      </div>
      <div style={{ fontSize: "1rem", color: "#c0c5cc", marginBottom: "1.5rem", textAlign: "center" }}>
        {status}
      </div>
      {!error && (
        <div style={{
          width: "32px", height: "32px",
          border: "3px solid rgba(41, 182, 246, 0.2)", borderTopColor: "#29b6f6",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
        }} />
      )}
      {error && (
        <>
          <div style={{ color: "#ff5252", fontSize: "0.875rem", marginTop: "1rem", maxWidth: "400px", textAlign: "center", wordBreak: "break-word" }}>
            {error}
          </div>
          <button onClick={() => {
            const returnUrl = getQueryParam("return") || "https://bulldoggx.com/version-test";
            window.location.href = returnUrl;
          }} style={{
            marginTop: "1rem", padding: "0.75rem 1.5rem", background: "#29b6f6",
            color: "#000", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer",
          }}>
            Return to app
          </button>
        </>
      )}
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
