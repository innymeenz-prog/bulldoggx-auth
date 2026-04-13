"use client";

import { useEffect, useState, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";

interface LinkedAccount {
  type: string;
  address?: string;
  walletClientType?: string;
  email?: string;
  subject?: string;
}

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const hasRedirected = useRef(false);
  const pollCount = useRef(0);

  const getQueryParam = (name: string): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get(name);
  };

  // Handle logout action
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
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Failed to open login";
          setError(msg);
        }
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [ready, authenticated, login]);

  // After login, wait for smart wallet then redirect
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (getQueryParam("action") === "logout") return;
    if (hasRedirected.current) return;

    const tryRedirect = () => {
      // Use the smart wallet address from useSmartWallets() — this matches
      // what sign/page.tsx uses for msg.sender on-chain.
      const walletAddress = smartWalletClient?.account?.address;

      if (!walletAddress) {
        pollCount.current += 1;
        if (pollCount.current >= 20) {
          setError(
            "Smart wallet provisioning is taking longer than expected. Please refresh and try again."
          );
          return;
        }
        setStatus(`Setting up your smart wallet... (${pollCount.current}/20)`);
        setTimeout(tryRedirect, 1000);
        return;
      }

      hasRedirected.current = true;
      setStatus("Redirecting you back...");

      const accounts = user.linkedAccounts as unknown as LinkedAccount[];
      const googleAccount = accounts.find((a) => a.type === "google_oauth");
      const discordAccount = accounts.find((a) => a.type === "discord_oauth");
      const twitterAccount = accounts.find((a) => a.type === "twitter_oauth");
      const emailAccount = accounts.find((a) => a.type === "email");

      const email =
        emailAccount?.email ||
        googleAccount?.email ||
        discordAccount?.email ||
        "";
      const googleId = googleAccount?.subject || "";
      const discordId = discordAccount?.subject || "";
      const twitterId = twitterAccount?.subject || "";
      const privyUserId = user.id;

      let provider = "email";
      if (googleAccount) provider = "google";
      else if (discordAccount) provider = "discord";
      else if (twitterAccount) provider = "twitter";

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

      window.location.href = `${baseReturn}?${params.toString()}`;
    };

    tryRedirect();
  }, [ready, authenticated, user, smartWalletClient]);

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
