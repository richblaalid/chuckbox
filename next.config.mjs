/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async redirects() {
    return [
      // Financial IA consolidation - redirect old routes to new /finances structure
      {
        source: '/accounts',
        destination: '/finances/accounts',
        permanent: true,
      },
      {
        source: '/accounts/:id',
        destination: '/finances/accounts/:id',
        permanent: true,
      },
      {
        source: '/billing',
        destination: '/finances/billing',
        permanent: true,
      },
      {
        source: '/payments',
        destination: '/finances/payments',
        permanent: true,
      },
      {
        source: '/reports',
        destination: '/finances/reports',
        permanent: true,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        // Allow CORS for extension auth API
        source: '/api/scoutbook/extension-auth',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        // Allow CORS for extension sync API
        source: '/api/scoutbook/extension-sync',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ]
  },
}

export default nextConfig
