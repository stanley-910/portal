import type { NextConfig } from "next";

// Tunnel hosts for testing the dev server with friends (cloudflared, ngrok). Both lists are dev-only in effect:
// the dev server refuses its own assets and HMR from any other host, and Server Actions refuse any other Origin.
const TUNNEL_HOSTS = ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io"];

const nextConfig: NextConfig = {
  allowedDevOrigins: TUNNEL_HOSTS,
  experimental: {
    serverActions: { allowedOrigins: process.env.NODE_ENV === "development" ? TUNNEL_HOSTS : [] },
  },
};

export default nextConfig;
