// sources/edpb.ts — EDPB guidance feed (the soft-law layer).
// RSS is just XML saying "here are my newest posts" — fetch it, parse it, flatten it.

import { XMLParser } from "fast-xml-parser";
import { EDPB_RSS_URL, USER_AGENT } from "../config.ts";

// Same clean-shape-at-the-door pattern as NewAct in eurlex.ts.
export interface FeedItem {
  title: string;
  link: string;
  date: string;
}

export async function fetchEdpbItems(): Promise<FeedItem[]> {
  const response = await fetch(EDPB_RSS_URL, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`EDPB RSS failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const feed = new XMLParser().parse(xml);

  // RSS shape: <rss><channel><item>...</item><item>...</item></channel></rss>
  // Gotcha: with exactly ONE <item>, the parser gives an object, not an array.
  const raw = feed.rss.channel.item ?? [];
  const items = Array.isArray(raw) ? raw : [raw];

  return items.map((item: any) => ({
    title: item.title,
    link: item.link,
    date: item.pubDate,
  }));
}
