export const URL_REGEX = /https?:\/\/[^\s]+/;

const COMMUNITY_HOSTS = [
  "linkedin.com",
  "x.com",
  "twitter.com",
  "reddit.com",
  "news.ycombinator.com",
  "news.hada.io",
];

export function isCommunityUrl(url: string): boolean {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return COMMUNITY_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`),
  );
}

export function extractYouTubeVideoId(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.hostname.includes("youtube.com")) {
    return parsed.searchParams.get("v");
  }
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1);
  }
  return null;
}
