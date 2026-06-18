# Default feed profile — one combined daily brief covering world news, France, and crypto.
# France bloc spans the spectrum (no extremes) and leans on neutral public anchors for balance.
# All feeds verified live (HTTP 200 + valid RSS via feedparser) on 2026-06-17.
RSS_FEEDS = [
    # --- World news ---
    "https://news.ycombinator.com/rss",                          # Hacker News
    "https://feeds.bbci.co.uk/news/world/rss.xml",               # BBC World
    "https://www.aljazeera.com/xml/rss/all.xml",                 # Al Jazeera
    "https://feeds.npr.org/1001/rss.xml",                        # NPR
    "https://www.theguardian.com/world/rss",                     # Guardian World
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",    # NYT World
    "https://www.ft.com/world?format=rss",                       # Financial Times World (teaser fallback; paywalled)
    # --- France & francophone (across the spectrum, no extremes) ---
    "https://www.mediapart.fr/articles/feed",                    # Mediapart (left, investigative)
    "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml",  # Libération (left)
    "https://www.lemonde.fr/rss/une.xml",                        # Le Monde (center-left)
    "https://www.francetvinfo.fr/titres.rss",                    # France Info (public broadcaster)
    "https://www.france24.com/fr/rss",                           # France 24 (public, international — neutral anchor)
    "https://www.lefigaro.fr/rss/figaro_actualites.xml",         # Le Figaro (center-right)
    # --- Crypto ecosystem ---
    "https://www.coindesk.com/arc/outboundfeeds/rss/",           # CoinDesk
    "https://cointelegraph.com/rss",                             # Cointelegraph
    "https://decrypt.co/feed",                                   # Decrypt
    "https://www.theblock.co/rss.xml",                           # The Block
    "https://www.dlnews.com/arc/outboundfeeds/rss/",             # DL News
]
