# simple-meridian/config.py

import os

from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Used in process_articles (operates globally, so uses default)
PROMPT_ARTICLE_SUMMARY = """
Summarize the key points of this news article objectively in 2-4 sentences.
Identify the main topics covered.

Article:
{article_content}
"""

# Used in rate_articles (operates globally, so uses default)
PROMPT_IMPACT_RATING = """
Analyze the following news summary and estimate its overall impact. Consider factors like geographic scope
(local vs global), number of people affected, severity, and potential long-term consequences.

Rate the impact on a scale of 1 to 10, where:
1-2: Minor, niche, or local interest.
3-4: Notable event for a specific region or community.
5-6: Significant event with broader regional or moderate international implications.
7-8: Major event with significant international importance or wide-reaching effects.
9-10: Critical global event with severe, widespread, or potentially historic implications.

Summary:
"{summary}"

Output ONLY the integer number representing your rating (1-10).
"""

# Persona used as the system prompt for the final brief synthesis call.
BRIEF_SYSTEM_PROMPT = """
You are an exceptionally well-informed, analytical intelligence briefer. You read between the lines, connect
related events, and contextualize them with quiet authority. You are precise, concrete, and objective — never
sensational, never speculative beyond what the evidence supports. You write clear, substantive prose for a
sharp reader who wants depth without filler.
"""

# Used in generate_brief (per cluster). Produces a substantive analytical paragraph.
PROMPT_CLUSTER_ANALYSIS = """
You are an intelligence analyst examining a cluster of related news articles from a '{feed_profile}' news mix.

{cluster_summaries_text}

Write a tight analytical paragraph (4-7 sentences) covering:
- the core event or development,
- the key facts and how it is unfolding,
- why it matters — context, drivers, and likely implications.
Base it ONLY on the provided text. Be specific and concrete (names, places, numbers). Neutral, analytical tone.
If the articles are genuinely unrelated, say so briefly and summarize the dominant one.
"""

# Used in generate_brief (final synthesis). Produces the long-form, sectioned brief.
PROMPT_BRIEF_SYNTHESIS = """
Write today's intelligence brief in Markdown from the analyzed story clusters below.

Use these section headings (omit a section only if there is genuinely nothing for it):
## What matters now  — the 3-5 highest-impact stories, each a substantive paragraph, most important first
## Global landscape  — other significant world / geopolitical / economic developments
## France  — developments concerning France (politics, society, economy)
## Crypto & markets  — cryptocurrency and market developments
## Tech & science  — technology, AI, and science developments
## Noteworthy  — smaller but interesting items, briefly

Rules:
- Cover EVERY significant cluster below. Do NOT drop the France or crypto stories — give them their own
  sections even if globally smaller.
- One flowing analytical paragraph per story (not bullet fragments). Lead each with a **bold headline**.
- Ground everything in the provided analyses; do not invent facts, sources, or dates. Do NOT add a dateline.
- Measured, analytical voice. Aim for roughly 1500-3000 words.

Analyzed story clusters (highest impact first):
{cluster_analyses_text}
"""

# Used in generate_brief to produce a short headline for the brief listing/title.
PROMPT_BRIEF_TITLE = """
Below is today's intelligence brief. Write a single concise headline (6-12 words) that captures the most
important theme of the day. It should read like a sharp newsletter title — specific and concrete, no date,
no quotation marks, no markdown, no trailing punctuation.

Output ONLY the headline text.

Brief:
{brief}
"""

# Used in generate_brief to produce a one-sentence "standfirst" summary shown under the title.
PROMPT_BRIEF_STANDFIRST = """
Below is today's intelligence brief. Write a single sentence (about 20-35 words) that summarizes the most
important threads of the day — a "standfirst" that sits under the headline. Concrete and specific, no date,
no markdown, no quotation marks.

Output ONLY the sentence.

Brief:
{brief}
"""

# Used in generate_brief to translate the standfirst into French.
PROMPT_TRANSLATE_STANDFIRST_FR = """
Translate this sentence into natural, fluent French. Output ONLY the translated sentence, no quotation marks.

{text}
"""

# Used in generate_brief to translate the finished English brief into French.
PROMPT_TRANSLATE_FR = """
Translate the following Markdown intelligence brief into natural, fluent French.
Preserve the Markdown structure EXACTLY: keep every heading level (##, ###), bold markers (**), lists, and
paragraph breaks identical — translate only the text. Use professional, journalistic French. Do not add,
remove, or summarize any content, and do not add commentary.

Output ONLY the translated Markdown.

{brief}
"""

# Used in generate_brief to translate the headline into French.
PROMPT_TRANSLATE_TITLE_FR = """
Translate this news headline into natural French. Output ONLY the translated headline, no quotation marks,
no trailing punctuation.

{title}
"""

# --- Processing Settings ---
# How many hours back to look for articles when generating a brief
BRIEFING_ARTICLE_LOOKBACK_HOURS = 24

# --- Model Settings ---
# Model for summarization and analysis (check Deepseek docs for latest models)
LLM_CHAT_MODEL = os.getenv("LLM_CHAT_MODEL", "deepseek/deepseek-chat")
# Stronger model used only for the final brief synthesis (1 call/run); the bulk
# per-article work stays on the cheap/fast LLM_CHAT_MODEL.
SYNTHESIS_MODEL = os.getenv("SYNTHESIS_MODEL", "gemini/gemini-2.5-flash")
# Model for embeddings
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "together_ai/intfloat/multilingual-e5-large-instruct")

# Approximate number of clusters to aim for. Higher = finer topic separation so
# smaller threads (France, crypto) form their own clusters instead of being absorbed.
N_CLUSTERS = 16

# Minimum number of articles required to attempt clustering/briefing
MIN_ARTICLES_FOR_BRIEFING = 5

ARTICLES_PER_PAGE = 15

MANUALLY_ADDED_PROFILE_NAME = "manual"
DEFAULT_FEED_PROFILE = "default"

# --- Other ---
DATABASE_FILE = "meridian.db"  # Keep for backward compatibility

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATABASE_FILE}")

# Flask configuration
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-key-change-in-production")
FLASK_ENV = os.getenv("FLASK_ENV", "development")
