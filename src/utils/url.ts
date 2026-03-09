import { COMMUNITY_HOSTS } from "../constants/hosts";

export const URL_REGEX = /https?:\/\/[^\s]+/;

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
