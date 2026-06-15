# Default feed profile — one combined daily brief covering world news, France, and crypto.
# All feeds verified live (HTTP 200 + valid RSS) on 2026-06-15.
RSS_FEEDS = [
    # --- World news ---
    "https://news.ycombinator.com/rss",                          # Hacker News
    "https://feeds.bbci.co.uk/news/world/rss.xml",               # BBC World
    "https://www.aljazeera.com/xml/rss/all.xml",                 # Al Jazeera
    "https://feeds.npr.org/1001/rss.xml",                        # NPR
    "https://www.theguardian.com/world/rss",                     # Guardian World
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",    # NYT World
    # --- France (across the spectrum, no extremes) ---
    "https://www.liberation.fr/arc/outboundfeeds/rss/?outputType=xml",  # Libération (left)
    "https://www.lemonde.fr/rss/une.xml",                        # Le Monde (center-left)
    "https://www.francetvinfo.fr/titres.rss",                    # France Info (public)
    "https://www.lexpress.fr/rss/alaune.xml",                    # L'Express (center)
    "https://www.lefigaro.fr/rss/figaro_actualites.xml",         # Le Figaro (center-right)
    # --- Crypto ecosystem ---
    "https://www.coindesk.com/arc/outboundfeeds/rss/",           # CoinDesk
    "https://cointelegraph.com/rss",                             # Cointelegraph
    "https://decrypt.co/feed",                                   # Decrypt
    "https://www.theblock.co/rss.xml",                           # The Block
    "https://www.dlnews.com/arc/outboundfeeds/rss/",             # DL News
]
