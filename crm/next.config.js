/** @type {import('next').NextConfig} */
const nextConfig = {
    // Required for Next.js 16+ with Turbopack
    turbopack: {},
    webpack: (config) => {
        config.resolve.alias = {
            ...config.resolve.alias,
            '@': __dirname,
        };
        return config;
    },
};

module.exports = nextConfig;
