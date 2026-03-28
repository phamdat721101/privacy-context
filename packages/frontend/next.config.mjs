/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    // Load @cofhe/sdk natively via Node.js so WASM resolves from node_modules,
    // instead of being bundled by webpack into the wrong server path.
    serverComponentsExternalPackages: ['@cofhe/sdk'],
  },
  webpack: (config) => {
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
};

export default config;
