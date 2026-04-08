"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);

  const getQueryParam = (name: string): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get(name);
  };

  // Handle logout action separately
  useEffect(() => {
    if (!ready) return;
    if (getQueryParam("action") === "logout" && authenticated) {
      logout().then(() => {
        const returnUrl = getQueryParam("return") || "https://bulldoggx.com";
        window.location.href = returnUrl;
      });
    }
  }, [ready, authenticated, logout]);

  // Auto-open login modal when ready
  useEffect(() => {
    if (!ready) {
      setStatus("Initializing...");
      return;
    }
    if (getQueryParam("action") === "logout") {
      setStatus("Logging out...");
      return;
    }
    if (!authenticated) {
      setStatus("Opening sign-in...");
      const timer = setTimeout(() => {
        try {
          login();
        } catch (e: any) {
          setError(e?.message || "Failed to open login");
        }
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [ready, authenticated, login]);

  // After login, extract wallet data and redirect back to Bubble
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (getQueryParam("action") === "logout") return;

    setStatus("Setting up your wallet...");

    const smartWallet = user.linkedAccounts.find(
      (account: any) => account.type === "smart_wallet"
    );
    const embeddedWallet = user.linkedAccounts.find(
      (account: any) =>
        account.type === "wallet" && account.walletClientType === "privy"
    );

    const walletAddress =
      (smartWallet as any)?.address || (embeddedWallet as any)?.address;

    if (!walletAddress) {
      setStatus("Finalizing wallet creation...");
      const retry = setTimeout(() => window.location.reload(), 1500);
      return () => clearTimeout(retry);
    }

    const email =
      user.email?.address ||
      (user.google as any)?.email ||
      (user.discord as any)?.email ||
      "";
    const googleId = (user.google as any)?.subject || "";
    const discordId = (user.discord as any)?.subject || "";
    const twitterId = (user.twitter as any)?.subject || "";
    const privyUserId = user.id;

    let provider = "email";
    if (user.google) provider = "google";
    else if (user.discord) provider = "discord";
    else if (user.twitter) provider = "twitter";

    const baseReturn =
      getQueryParam("return") || "https://bulldoggx.com/version-test";

    const params = new URLSearchParams({
      view: "onboarding",
      wallet: walletAddress,
      email: email,
      privy_id: privyUserId,
      provider: provider,
      google_id: googleId,
      discord_id: discordId,
      twitter_id: twitterId,
    });

    setStatus("Redirecting you back...");
    window.location.href = `${baseReturn}?${params.toString()}`;
  }, [ready, authenticated, user]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#1a1d23",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: "2rem",
      }}
    >
      <div
        style={{
          fontSize: "2.5rem",
          fontWeight: 900,
          letterSpacing: "0.05em",
          marginBottom: "0.5rem",
        }}
      >
        BULLDOG<span style={{ color: "#29b6f6" }}>GX</span>
      </div>
      <div
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.2em",
          color: "#8a8f99",
          marginBottom: "3rem",
        }}
      >
        GAMERS. BEST. FRIEND.
      </div>

      <div
        style={{
          fontSize: "1rem",
          color: "#c0c5cc",
          marginBottom: "1.5rem",
        }}
      >
        {status}
      </div>

      {!error && (
        <div
          style={{
            width: "32px",
            height: "32px",
            border: "3px solid rgba(41, 182, 246, 0.2)",
            borderTopColor: "#29b6f6",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      )}

      {error && (
        <>
          <div
            style={{
              color: "#ff5252",
              fontSize: "0.875rem",
              marginTop: "1rem",
              maxWidth: "400px",
              textAlign: "center",
            }}
          >
            {error}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1.5rem",
              background: "#29b6f6",
              color: "#000",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </>
      )}

      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}
