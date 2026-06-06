/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    // Packages that must be loaded natively by Node (not bundled by webpack):
    //   - @cofhe/sdk        — WASM resolves from node_modules
    //   - @mysten-incubation/memwal — optional peer dep, gated at runtime by
    //     MEMWAL_PEERDEP_ENABLED; webpack must not try to resolve it at build
    //     time (G4 isolation lives in packages/sdk/src/memwal/adapter.ts).
    serverComponentsExternalPackages: ['@cofhe/sdk', '@mysten-incubation/memwal'],
  },
  webpack: (config, { webpack, isServer }) => {
    // Client bundle: the MemWal peer dep is server-only. Tell webpack the
    // request resolves to nothing so the optional `await import(...)` in the
    // SDK simply rejects at runtime — the SDK's try/catch already handles it.
    if (!isServer) {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^@mysten-incubation\/memwal$/,
        }),
      );
    }
    // Stub the React Native storage module pulled in by @metamask/sdk → @wagmi/connectors.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // Enable async WebAssembly for the client bundle (TFHE used by CoFHE SDK).
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
  // Legacy → openx URL map. All temporary (308) so search engines don't
  // freeze a stale redirect once the rewrite settles.
  // NOTE: /brain is intentionally NOT in this list — it now hosts the
  //       Cognitive Memory v1 surface (L1/L2/L3, Fhenix-encrypted, Postgres-
  //       backed). The old "/brain → /studio" alias was a different feature
  //       and has been retired. Do not re-add it.
  async redirects() {
    return [
      { source: '/onboard', destination: '/docs', permanent: false },
      { source: '/payments', destination: '/settings', permanent: false },
      { source: '/v2', destination: '/', permanent: false },
      { source: '/zama-demo', destination: '/', permanent: false },
      { source: '/catalog', destination: '/marketplace', permanent: false },
      { source: '/settings-v2', destination: '/settings', permanent: false },
      // /memory was the old Arkiv Memory Tier — now retired; route bookmarks to /brain.
      { source: '/memory', destination: '/brain', permanent: false },
      // Bare /chat with no agent goes back to discovery.
      { source: '/chat', destination: '/marketplace', permanent: false },
    ];
  },
};

export default config;
