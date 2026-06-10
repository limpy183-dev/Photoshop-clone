// Mirrors basePath from next.config.mjs for places Next.js does not prefix
// automatically: <Image> srcs when images.unoptimized is set, and plain URLs.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export const withBasePath = (p: string) => BASE_PATH + p

// True for GITHUB_PAGES static-export builds, where app/api routes do not exist.
export const IS_STATIC_DEPLOY = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true"
