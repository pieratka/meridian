# Legacy brief prompts (from reportV5.ipynb)

> Extracted from the retired Cloudflare-era orchestration notebook `apps/briefs/reportV5.ipynb`
> (branch `revive-brief-pipeline`). These multi-stage prompts are richer than meridiano's built-in
> `PROMPT_CLUSTER_ANALYSIS` / `PROMPT_BRIEF_SYNTHESIS`. Kept here to fold into `config_base.py` later.
> The original pipeline: cluster review → per-story deep analysis → outline → brief → title → TLDR.


---

## Cell 14 — Cluster review — story extraction & validation (Pydantic Story/StoryValidation models + prompt)

```python
import base64
import os
from google.genai import types
from retry import retry
import json
from json_repair import repair_json
from pydantic import BaseModel, Field, model_validator
from typing import List, Literal, Optional
from src.llm import call_llm


class Story(BaseModel):
    title: str = Field(description="title of the story")
    importance: int = Field(
        ge=1,
        le=10,
        description="global significance (1=minor local event, 10=major global impact)",
    )
    articles: List[int] = Field(description="list of article ids in the story")


class StoryValidation(BaseModel):
    answer: Literal["single_story", "collection_of_stories", "pure_noise", "no_stories"]

    # optional fields that depend on the answer type
    title: Optional[str] = None
    importance: Optional[int] = Field(None, ge=1, le=10)
    outliers: List[int] = Field(default_factory=list)
    stories: Optional[List[Story]] = None

    @model_validator(mode="after")
    def validate_structure(self):
        if self.answer == "single_story":
            if self.title is None or self.importance is None:
                raise ValueError(
                    "'title' and 'importance' are required for 'single_story'"
                )
            if self.stories is not None:
                raise ValueError("'stories' should not be present for 'single_story'")

        elif self.answer == "collection_of_stories":
            if not self.stories:
                raise ValueError("'stories' is required for 'collection_of_stories'")
            if self.title is not None or self.importance is not None or self.outliers:
                raise ValueError(
                    "'title', 'importance', and 'outliers' should not be present for 'collection_of_stories'"
                )

        elif self.answer == "pure_noise" or self.answer == "no_stories":
            if (
                self.title is not None
                or self.importance is not None
                or self.outliers
                or self.stories is not None
            ):
                raise ValueError(
                    "no additional fields should be present for 'pure_noise'"
                )

        return self


@retry(tries=3, delay=2, backoff=2, jitter=2, max_delay=20)
def process_story(cluster):

    story_articles_ids = cluster["articles_ids"]

    story_article_md = ""
    for article_id in story_articles_ids:
        article = next((e for e in events if e.id == article_id), None)
        if article is None:
            continue
        story_article_md += f"- (#{article.id}) [{article.title}]({article.url})\n"
        # story_article_md += f"> {article.publishDate}\n\n"
        # story_article_md += f"```\n{article.content}\n```\n\n"
    story_article_md = story_article_md.strip()

    prompt = f"""
# Task
Determine if the following collection of news articles is:
1) A single story - A cohesive narrative where all articles relate to the same central event/situation and its direct consequences
2) A collection of stories - Distinct narratives that should be analyzed separately
3) Pure noise - Random articles with no meaningful pattern
4) No stories - Distinct narratives but none of them have more than 3 articles

# Important clarification
A "single story" can still have multiple aspects or angles. What matters is whether the articles collectively tell one broader narrative where understanding each part enhances understanding of the whole.

# Handling outliers
- For single stories: You can exclude true outliers in an "outliers" array
- For collections: Focus **only** on substantive stories (3+ articles). Ignore one-off articles or noise.

# Title guidelines
- Titles should be purely factual, descriptive and neutral
- Include necessary context (region, countries, institutions involved)
- No editorialization, opinion, or emotional language
- Format: "[Subject] [action/event] in/with [location/context]"

# Input data
Articles (format is (#id) [title](url)):
{story_article_md}

# Output format
Start by reasoning step by step. Consider:
- Central themes and events
- Temporal relationships (are events happening in the same timeframe?)
- Causal relationships (do events influence each other?)
- Whether splitting the narrative would lose important context

Return your final answer in JSON format:
```json
{{
    "answer": "single_story" | "collection_of_stories" | "pure_noise",
    // single_story_start: if answer is "single_story", include the following fields:
    "title": "title of the story",
    "importance": 1-10, // global significance (1=minor local event, 10=major global impact)
    "outliers": [] // array of article ids to exclude as unrelated
    // single_story_end
    // collection_of_stories_start: if answer is "collection_of_stories", include the following fields:
    "stories": [
        {{
            "title": "title of the story",
            "importance": 1-10, // global significance scale
            "articles": [] // list of article ids in the story (**only** include substantial stories with **3+ articles**)
        }},
        ...
    ]
    // collection_of_stories_end
}}
```

Example for a single story:
```json
{{
    "answer": "single_story",
    "title": "The Great Fire of London",
    "importance": 8,
    "outliers": [123, 456] // article ids to exclude as unrelated
}}
```

Example for a collection of stories:
```json
{{
    "answer": "collection_of_stories",
    "stories": [
        {{
            "title": "The Great Fire of London",
            "importance": 8,
            "articles": [123, 456] // article ids in the story
        }},
        ...
    ]
}}
```

Example for pure noise:
```json
{{
    "answer": "pure_noise"
}}
```

Example for a distinct narratives with no stories that contain more than 3+ articles:
```json
{{
    "answer": "no_stories",
}}
```

Note:
- Always include articles IDs (outliers, articles, etc...) as integers, not strings and never include the # symbol.
""".strip()

    answer, usage = call_llm(
        model="gemini-2.0-flash",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    try:
        assert "```json" in answer
        answer = answer.split("```json")[1]
        if answer.endswith("```"):
            answer = answer[:-3]
        answer = answer.strip()
        answer = repair_json(answer)
        answer = json.loads(answer)
        parsed = StoryValidation(**answer)
    except Exception as e:
        print(f"Error parsing story: {e}")
        print(cluster)
        print(answer)
        raise e

    return (parsed, usage)
```

---

## Cell 22 — Deep per-story analysis (final_process_story: feeds full article text, structured JSON analysis)

```python
import base64
import os
import tiktoken

enc = tiktoken.get_encoding("o200k_base")


@retry(
    tries=4, delay=2, backoff=2, jitter=1, max_delay=20
)  # max_delay=180 means never wait more than 3 mins
def final_process_story(title: str, articles_ids: list[int]):

    story_article_md = ""
    full_articles = []
    for article_id in articles_ids:
        article = next((e for e in events if e.id == article_id), None)
        if article is None:
            print(f"Article {article_id} not found")
            continue
        else:
            full_articles.append(article)

    # sort by publish date (from latest to oldest)
    # full_articles = sorted(full_articles, key=lambda x: x["publishDate"], reverse=True)
    for article in full_articles:
        story_article_md += f"## [{article.title}]({article.url}) (#{article.id})\n\n"
        story_article_md += f"> {article.publishDate}\n\n"
        story_article_md += f"```\n{article.content}\n```\n\n"

    story_article_md = story_article_md.strip()

    pre_prompt = """
You are a highly skilled intelligence analyst working for a prestigious agency. Your task is to analyze a cluster of related news articles and extract structured information for an executive intelligence report. The quality, accuracy, precision, and **consistency** of your analysis are crucial, as this report will directly inform a high-level daily brief and potentially decision-making.

First, assess if the articles provided contain sufficient content for analysis:

Here is the cluster of related news articles you need to analyze:

<articles>
""".strip()

    post_prompt = """
</articles>

BEGIN ARTICLE QUALITY CHECK:
Before proceeding with analysis, verify if the articles contain sufficient information:
1. Check if articles appear empty or contain minimal text (fewer than ~50 words each)
2. Check for paywall indicators ("subscribe to continue", "premium content", etc.)
3. Check if articles only contain headlines/URLs but no actual content
4. Check if articles appear truncated or cut off mid-sentence

If ANY of these conditions are true, return ONLY this JSON structure inside <final_json> tags:
<final_json>
{
    "status": "incomplete",
    "reason": "Brief explanation of why analysis couldn't be completed (empty articles, paywalled content, etc.)",
    "availableInfo": "Brief summary of any information that was available"
}
</final_json>

ONLY IF the articles contain sufficient information for analysis, proceed with the full analysis below:

Your goal is to extract and synthesize information from these articles into a structured format suitable for generating a daily intelligence brief.

Before addressing the main categories, conduct a preliminary analysis:
a) List key themes across all articles
b) Note any recurring names, places, or events
c) Identify potential biases or conflicting information
It's okay for this section to be quite long as it helps structure your thinking.

Then, after your preliminary analysis, present your final analysis in a structured JSON format inside <final_json> tags. This must be valid, parseable JSON that follows this **exact refined structure**:

**Detailed Instructions for JSON Fields:**
*   **`status`**: 'complete' or 'incomplete'
*   **`title`**: Terse, neutral title of the story
*   **`executiveSummary`**: Provide a 2-4 sentence concise summary highlighting the most critical developments, key conflicts, and overall assessment from the articles. This should be suitable for a quick read in a daily brief.
*   **`storyStatus`**: Assess the current state of the story's development based *only* on the information in the articles. Use one of: 'Developing', 'Escalating', 'De-escalating', 'Concluding', 'Static'.
*   **`timeline`**: List key events in chronological order.
    *   `description`: Keep descriptions brief and factual.
    *   `importance`: Assess the event's importance to understanding the overall narrative (High/Medium/Low). High importance implies the event is central to the story's development or outcome.
*   **`signalStrength`**: Assess the overall reliability of the reporting *in this cluster*.
    *   `assessment`: Use a qualitative term: 'Very High', 'High', 'Moderate', 'Low', 'Very Low'.
    *   `reasoning`: Justify the assessment based on source corroboration (how many sources report the same core facts?), source quality/reliability (mix of reputable vs. biased sources?), presence of official statements, and degree of conflicting information on core facts.
*   **`undisputedKeyFacts`**: List core factual points that are corroborated across multiple, generally reliable sources within the cluster. Avoid claims made only by highly biased sources unless corroborated.
*   **`keyEntities`**: Identify the main actors.
    *   `list`: Provide basic identification and their role/involvement.
    *   `perspectives.statedPositions`: Focus *only* on the goals, viewpoints, or justifications explicitly stated or clearly implied by the entity *as reported in the articles*. Avoid listing conflicting claims here (that goes in `contradictions`).
*   **`keySources`**: Analyze the provided news sources.
    *   `provided_articles_sources.reliabilityAssessment`: Assess the source's general reliability based on reputation, known biases (political, state affiliation, ideological), and fact-checking standards. Use terms like 'High Reliability', 'Moderate Reliability', 'Low Reliability', 'State-Affiliated/Propaganda Outlet'. Be specific about the *type* of bias.
    *   `provided_articles_sources.framing`: Describe the narrative angle or style used by the source (e.g., 'Emphasizes security threat', 'Focuses on human rights angle', 'Uses neutral language', 'Uses loaded/emotional language', 'Presents government narrative uncritically').
    *   `contradictions`: Detail specific points of disagreement *between sources* or *between entities as reported by sources*.
        *   `issue`: Clearly state what is being contested.
        *   `conflictingClaims`: List the different versions, specifying the `source` reporting it, the `claim` itself, and optionally the `entityClaimed` if the source attributes the claim to a specific entity. Critically evaluate claims originating solely from low-reliability/propaganda sources.
*   **`context`**: List essential background information *mentioned or clearly implied in the articles* needed to understand the story.
*   **`informationGaps`**: Identify crucial pieces of information *missing* from the articles that would be needed for a complete understanding.
*   **`significance`**: Assess the overall importance of the reported events.
    *   `assessment`: Use a qualitative term: 'Critical', 'High', 'Moderate', 'Low'.
    *   `reasoning`: Explain *why* this story matters. Consider immediate impact, potential future developments, strategic implications, precedent setting, regional/global relevance.
    *   `score`: An integer between 0 (lowest importance story) and 10 (most critical story)

**Refined JSON Structure to Follow:**

```json
{
    "status": "complete",
    "title": "string",
    "executiveSummary": "string",
    "storyStatus": "string",
    "timeline": [
        {
            "date": "YYYY-MM-DD or approximate",
            "description": "brief event description",
            "importance": "string: High/Medium/Low"
        }
    ],
    "signalStrength": {
        "assessment": "string: Very High/High/Moderate/Low/Very Low",
        "reasoning": "string"
    },
    "undisputedKeyFacts": [
        "string"
    ],
    "keyEntities": {
        "list": [
            {
                "name": "entity name",
                "type": "type of entity",
                "description": "brief description",
                "involvement": "why/how involved?"
            }
        ],
        "perspectives": [
            {
                "entity": "entity name",
                "statedPositions": [
                    "string"
                ]
            }
        ]
    },
    "keySources": {
        "provided_articles_sources": [
            {
                "name": "source entity name",
                "articles": [], // int array of IDs
                "reliabilityAssessment": "string",
                "framing": [
                    "string"
                ]
            }
        ],
        "contradictions": [
            {
                "issue": "string",
                "conflictingClaims": [
                    {
                        "source": "media source name",
                        "entityClaimed": "entity name (optional)",
                        "claim": "string"
                    }
                ]
            }
        ]
    },
    "context": [
        "string"
    ],
    "informationGaps": [
        "string"
    ],
    "significance": {
        "assessment": "string: Critical/High/Moderate/Low",
        "reasoning": "string",
        "score": 0
    }
}
```

**CRITICAL Quality & Consistency Requirements:**

*   **Thoroughness:** Ensure all fields, especially descriptions, reasoning, context, and summaries, are detailed and specific. Avoid superficial or overly brief entries. Your analysis must reflect deep engagement with the provided texts.
*   **Grounding:** Base your entire analysis **SOLELY** on the content within the provided `<articles>` tags. Do not introduce outside information, assumptions, or knowledge.
*   **No Brevity Over Clarity:** Do **NOT** provide one-sentence descriptions or reasoning where detailed analysis is required by the field definition.
*   **Scrutinize Sources:** Pay close attention to the reliability assessment of sources when evaluating claims, especially in the `contradictions` section. Note when a claim originates primarily or solely from a low-reliability source.
*   **Validity:** Your JSON inside `<final_json></final_json>` tags MUST be 100% fully valid with no trailing commas, properly quoted strings and escaped characters where needed, and follow the exact refined structure provided. Ensure keys are in the specified order. Your entire JSON output should be directly extractable and parseable without human intervention.

Return your complete response, including your preliminary analysis/thinking in any format you prefer, followed by the **full** valid JSON inside `<final_json></final_json>` tags.
""".strip()

    # enc.decode(enc.encode("hello world"))
    tokens = enc.encode(story_article_md)

    # only keep the first million tokens
    tokens = tokens[:850_000]
    story_article_md = enc.decode(tokens)

    prompt = pre_prompt + "\n\n" + story_article_md + "\n\n" + post_prompt
    # print(prompt)

    answer, usage = call_llm(
        model="gemini-2.0-flash",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    text = answer

    if "```json" in text:
        text = text.split("```json")[1]
        text = text.strip()

    if "<final_json>" in text:
        text = text.split("<final_json>")[1]
        text = text.strip()

    if "</final_json>" in text:
        text = text.split("</final_json>")[0]
        text = text.strip()

    if text.endswith("```"):
        text = text.replace("```", "")
        text = text.strip()

    # text = repair_json(text)

    # assert "significance" in text

    return answer, usage
```

---

## Cell 30 — Brief system prompt — the analyst persona

```python

brief_system_prompt = """
Adopt the persona of an exceptionally well-informed, highly analytical, and subtly world-weary intelligence briefer. Imagine you possess near-instantaneous access to the firehose of global information, coupled with the processing power to sift, connect, and contextualize it all. But you're far more than just a data aggregator.

**Your Core Identity:** You are the indispensable analyst – the one who reads between the lines, understands the subtext, connects seemingly unrelated events, and sees the underlying currents shaping the world. You possess a deep, almost intuitive grasp of geopolitics, economics, and human behavior, grounded in relentless observation and pattern recognition. You're not impressed by titles or official narratives; you focus on incentives, capabilities, and the often-messy reality on the ground.

**Your Analytical Voice & Tone:**

1.  **Direct & Grounded:** Speak plainly, like an experienced hand briefing a trusted colleague. Your authority comes from the clarity and depth of your analysis, not from formality. Facts are your foundation, but insight is your currency.
2.  **Insight over Summary:** Don't just report *what* happened. Explain *why* it matters, *who* benefits, *what* might happen next (and the *why* behind that too). Identify the signal in the noise, assess motivations, flag inconsistencies, and highlight underappreciated angles. Deliver a clear, defensible "take."
3.  **Economical & Precise Language:** Channel a spirit akin to Hemingway: clarity, conciseness, strong verbs. Every sentence should serve a purpose. Avoid jargon, buzzwords, euphemisms, and hedging ("it seems," "potentially," "could possibly"). State your analysis with confidence, grounded in the available information. If there's ambiguity, state *that* clearly too, but don't waffle.
4.  **Understated Wit & Skepticism:** Your perspective is sharp, informed by seeing countless cycles of events. A dry, observational wit might surface naturally when confronting absurdity, spin, or predictable human folly. This isn't about forced jokes; it's the wry acknowledgment of reality by someone who's paying close attention. Zero tolerance for BS, propaganda, or obfuscation.
5.  **Engaging Clarity:** The ultimate goal is to deliver intelligence that is not only accurate and insightful but also *compelling* and *pleasant* to read. The quality of the writing should match the quality of the analysis. Make complex topics understandable and genuinely interesting through sheer clarity and perceptive commentary.

**Think of yourself as:** The definitive source for understanding *what's actually going on*. You have the raw data, the analytical engine, and the seasoned perspective to cut through the clutter and deliver the essential, unvarnished intelligence with precision, insight, and a distinct, trustworthy voice. You make the complex clear, and the important engaging.
""".strip()
```

---

## Cell 31 — Outline stage — assembling <story> blocks for the outliner

```python
# Prepare the input string for the outlining prompt (same as before)
input_summaries_string = ""
for clus in final_json_to_process: # Assuming final_json_to_process holds the dicts
    score_str = f" ({clus['significance'].get('score', 'N/A')})" if 'score' in clus['significance'] else ""
    input_summaries_string += f"""
<story>
# {clus.get('title', 'Untitled Story')}
**Status:** {clus.get('storyStatus', 'N/A')} | **Signal Strength:** {clus['signalStrength'].get('assessment', 'N/A')} | **Significance:** {clus['significance'].get('assessment', 'N/A')}{score_str}
> {clus.get('executiveSummary', 'No executive summary provided.')}
</story>
"""
input_summaries_string = input_summaries_string.strip()

# Now, create the prompt for a dense, title-only outline with improved example
outlining_prompt = f"""
You are an assistant tasked with creating a structured, *title-only* outline from analyzed news stories. This outline will guide a subsequent process to generate a full intelligence brief. Your goal is to categorize stories and group related developments thematically based on a holistic analysis of all provided input.

Your input is a collection of analyzed story summaries, each marked with `<story>` tags, containing Title, Status, Signal Strength, Significance, Score, and Executive Summary.

Your goal is to produce a markdown outline by:
1.  Identifying the most critical overall developments or themes revealed by the stories.
2.  Identifying and grouping stories covering related events or themes.
3.  Assigning individual story titles and grouped titles to the most appropriate section based on significance and user interests (geopolitics, France, China, tech).
4.  **Outputting *only* the section structure and the actual titles of the assigned stories.**

**Final Brief Structure & Section Guidelines:** (Use these to categorize)

1.  **`## What matters now`**: Titles representing the up to 10 most important/impactful overall developments *from this batch*, based on relative significance and thematic importance. Use judgment. If multiple stories cover facets of one *major* event/theme, select the title representing the core update or highest impact for this section. Try to keep the top spots for newest developments (i.e if we reported on something yesterday, it should only be in the top 3 if it's truly huge, otherwise leave the top spots for the newest developments)
2.  **`## France focus`**: Titles primarily focused on France.
3.  **`## Global landscape`**: (Includes `### power & politics`). Titles covering broader geopolitics, international relations.
4.  **`## China monitor`**: Titles primarily focused on China (policy, economy, tech, etc.).
5.  **`## Economic currents`**: Titles covering significant global/regional economic news, trends, policy.
6.  **`## Tech & science developments`**: Titles covering AI/LLMs, biomed, space breakthroughs, etc.
7.  **`## Noteworthy & under-reported`**: Titles for interesting/potentially important stories not fitting elsewhere, emerging trends. (Up to ~5 titles).
8.  **`## Positive developments`**: Titles for genuinely positive outcomes. (Include only if applicable).

**Instructions:**

1.  **Analyze Holistically:** First, carefully read *all* provided `<story>` summaries below (titles and summaries) to understand the key events, themes, and potential connections *before* assigning anything. Think about the bigger picture revealed by the collection.
2.  **Select "What Matters Now":** Identify the *actual titles* of the stories representing the top ~10 most significant overall developments or themes within this batch. List these titles under `## what matters now`, ordered by significance/impact.
3.  **Assign & Group Remaining Story Titles:** For the ***remaining*** stories:
    *   Assign each story's **actual Title** to the single most appropriate section.
    *   **Group Related Titles:** If two or more stories cover the same specific event, interconnected themes, or closely linked developments, place their **actual Titles consecutively** *within* the single most relevant section.
    *   **Prioritize Group Placement:** Assign the *entire group* of related titles to the section that best captures their central theme.
4.  **Formatting:**
    *   Format the output *exactly* as shown in the example below, using the appropriate section headers (`## Section Name`, `### power & politics`).
    *   List **only the actual `Title`** of each story under its assigned section, preceded by `###`.
    *   Use `---` as a separator between *each* story title listed.
    *   If a section has no relevant stories, **omit the section header entirely**.
5.  **Output:**
    *   **Do NOT include introductory/concluding text, explanations, the `<story>` tags, or the executive summaries.**
    *   **Output ONLY the structured markdown outline consisting of section headers and the actual story titles from the input data.**
    
**--- CONTEXT FROM PREVIOUS DAY (IF AVAILABLE) ---**
*   You *may* receive a section at the beginning of the curated data titled `## Previous Day's Coverage Context (YYYY-MM-DD)`.
*   Use this list **only** to understand which topics are ongoing and their last known status/theme.
*   Focus on **today's developments** based on the main `<input_data>`. Reference past context briefly *only if essential*.
**--- END CONTEXT INSTRUCTIONS ---**

**Input Data:**

<previous_day_context>
{latest_report}
</previous_day_context>

<input_data>
{input_summaries_string}
</input_data>

**Required Output Format Example:** (Uses placeholders for structure illustration only; your output must use the *actual titles* from the input)

```markdown
## What matters now

### [Actual Title Representing Top Development 1]
---
### [Actual Title Representing Top Development 2]
---
### [Actual Title Related to Development 2 or New Top Development 3]
---
...(up to 10 actual titles total)


## France focus

### [Actual Title Covering French Theme A - Part 1]
---
### [Actual Title Covering French Theme A - Part 2]
---
### [Actual Title of Distinct French Event B]


## Global landscape

### power & politics

### [Actual Title on Geopolitical Issue X - Update 1]
---
### [Actual Title on Geopolitical Issue X - Update 2]
---
### [Actual Title on Distinct Geopolitical Issue Y]


## Economic currents

### [Actual Title for Economic Trend P]
---
### [Actual Title for Economic Trend Q]


## Tech & science developments

### [Actual Title for Tech Theme M - Aspect 1]
---
### [Actual Title for Tech Theme M - Aspect 2]


## Noteworthy & under-reported

### [Actual Title for Noteworthy Item 1]
---
### [Actual Title for Noteworthy Item 2]
---
...(up to ~5 actual titles)
""".strip()

# You would then call the LLM (e.g., Gemini Flash) with this prompt:
outline_response = call_llm(
    model="gemini-2.0-flash-thinking-exp-01-21", # Or similar cheap/fast model
    messages=[
        {"role": "system", "content": brief_system_prompt},
        {"role": "user", "content": outlining_prompt}
        ],
    temperature=0.0 # Low temp for deterministic structuring
)
```

---

## Cell 35 — Main brief generation prompt (get_brief_prompt: curated_news + outline_guide + previous-day context)

```python
def get_brief_prompt(curated_news: str, outline_guide: str, latest_report: str = ""): # Added latest_report arg based on prompt content
    """
    Generates the prompt for the main brief creation LLM call, using a pre-defined outline.

    Args:
        curated_news: String containing the full <story> blocks (summaries, metadata).
        outline_guide: String containing the dense, title-only markdown outline.
        latest_report: String containing optional context from the previous day.

    Returns:
        The formatted prompt string.
    """
    prompt = f"""
You are tasked with generating a personalized daily intelligence brief based on a curated set of news analyses and a provided structural outline. Aim for something comprehensive yet engaging, roughly a 20-30 minute read.

**User Interests:** Significant world news (geopolitics, politics, finance, economics), US news, France news (user is French/lives in France), China news (especially policy, economy, tech - seeking insights often missed in western media), and Technology/Science (AI/LLMs, biomed, space, real breakthroughs). Also include noteworthy items.

**Goal:** Leverage your analysis capabilities to create a focused brief that explains what's happening, why it matters, who's saying what, who's reporting what and identifies connections others might miss. The user values **informed, analytical takes**, grounded in the provided facts, but appreciates directness and avoids generic hedging or forced political correctness.

**Your Task:**

1.  **Adhere Strictly to the Provided Outline:** The structure (sections and order of topics) of your brief *must* follow the `## Provided Outline` section below exactly.
2.  **Process Curated Data:** Use the full story details found within the `<curated_news_data>` section as your source material.
3.  **Connect Outline to Data:** For each `### Title` listed in the `## Provided Outline`, locate the corresponding full story information (summary, metadata) within `<curated_news_data>`.
4.  **Synthesize and Analyze:** Write the brief content for that story, following the style and content guidelines for each section. Pay attention to titles grouped consecutively in the outline – these represent related developments; synthesize them coherently, but still apply paragraph structure rules *within* each story's coverage.
5.  **Generate Engaging Titles:** For *each* story covered (as dictated by the outline), create an engaging `<u>**title that captures the essence**</u>` for the brief itself. Do *not* just reuse the raw input titles from the outline for the brief's display titles.

**--- CONTEXT FROM PREVIOUS DAY (IF AVAILABLE) ---**
*   You *may* receive a section at the beginning of the curated data titled `## Previous Day's Coverage Context (YYYY-MM-DD)`.
*   Use this list **only** to understand which topics are ongoing and their last known status/theme.
*   Focus on **today's developments** based on the main `<curated_news_data>`. Reference past context briefly *only if essential*.
*   **Do NOT simply rewrite or extensively quote the Previous Day's Coverage Context.**
**--- END CONTEXT INSTRUCTIONS ---**

**--- PROVIDED OUTLINE (Follow This Structure) ---**

<outline_guide>
{outline_guide}
</outline_guide>

**--- CURATED NEWS DATA (Source Material) ---**

{latest_report}

<curated_news_data>
{curated_news}
</curated_news_data>

**--- BRIEF STRUCTURE AND CONTENT GUIDELINES ---**

Use the section headers provided in the outline (`## what matters now`, `## france focus`, etc., including `### power & politics` where specified).
For **each story** identified by a title in the outline:

1.  **Create a Title:** Generate an engaging title using the format:
    ```
    <u>**Title that captures the essence**</u>
    ```
2.  **Write the Content:**
    *   Address what happened, why it matters (significance, implications), key context, and your analytical take (based on the provided facts and context for that story, what are the likely motivations, potential second-order effects, overlooked angles, or inconsistencies? Ground this analysis in the data) in natural, flowing prose.
    *   **Crucially: Use multiple, distinct paragraphs *within each story's section* to improve readability.** Separate distinct ideas, shifts in focus, or different aspects (e.g., separating the core event summary from the analysis/implications) with paragraph breaks (a blank line between paragraphs).
    *   **Do not cram all information for a single story into one large block of text.** Aim for paragraphs that are typically 2-5 sentences long, varying length for effect but prioritizing clarity.
    *   Ensure smooth transitions *between* paragraphs and *between* related stories grouped in the outline.
    *   Blend facts and analysis naturally. If there isn't much significant development or analysis *for a specific story*, keep its section concise, possibly with just one or two short paragraphs, but still apply the paragraph break principle where logical.
    *   Use **bold** for key specifics (names, places, numbers, orgs).
    *   Use *italics* for important context or secondary details.
    *   Follow the specific focus described for each section (`## france focus`, `## china monitor`, etc.) when framing your analysis for stories within those sections.

**--- FINAL INSTRUCTIONS ---**

*   Enclose the entire brief content inside `<final_brief></final_brief>` tags. Do not include conversational filler before or after these tags.
*   Use complete sentences and standard capitalization/grammar.
*   Be direct and analytical, aligning with the persona guided by the system prompt (well-informed, analytical friend with dry wit).
*   **Source Reliability:** The input data is derived from analyses that assessed source reliability. Use this implicit understanding – give more weight to reliable sources and treat claims from low-reliability sources with appropriate caution in your analysis. Explicit mention isn't needed unless crucial.
*   **Writing Style:** Aim for insightful, engaging prose. Make complex topics clear. Integrate facts, significance, and your take naturally, **using appropriate paragraph breaks for structure and readability.**
*   **Leverage Your Strengths:** Process all the info *guided by the outline*, spot cross-domain patterns *where the outline groups related items*, draw on relevant background knowledge, explain clearly, and provide that grounded-yet-insightful analytical layer.

Generate the final brief based *strictly* on the provided outline and sourced from the curated data.
""".strip()
    return prompt

brief_prompt = get_brief_prompt(stories_markdown, brief_outline)

brief_model = "gemini-2.5-pro-exp-03-25"

brief_response = call_llm(
    model=brief_model,
    messages=[
        {"role": "system", "content": brief_system_prompt},
        {"role": "user", "content": brief_prompt},
    ],
    temperature=0,
)
```

---

## Cell 38 — Brief title prompt

```python
import os
from openai import OpenAI
from dotenv import load_dotenv
import base64
import os
from google import genai
from google.genai import types


load_dotenv()
client = genai.Client(
    api_key=os.environ.get("GOOGLE_API_KEY"),
)


brief_title_prompt = f"""
<brief>
{final_brief_text}
</brief>

Create a title for the brief. Construct it using the main topics. It should be short/punchy/not clickbaity etc. Make sure to not use "short text: longer text here for some reason" i HATE it, under no circumstance should there be colons in the title. Make sure it's not too vague/generic either bc there might be many stories. Maybe don't focus on like restituting what happened in the title, just do like the major entities/actors/things that happened. like "[person A], [thing 1], [org B] & [person O]" etc. try not to use verbs. state topics instead of stating topics + adding "shakes world order".

Yesterday's title was: {latest_report['title']}, so try to shake it up a little if we're talking about some of the same topics.

Return exclusively a JSON object with the following format:
```json
{{
    "title": "string"
}}
```
""".strip()


brief_title_response = call_llm(
    model="gemini-2.0-flash",
    messages=[
        {"role": "user", "content": brief_title_prompt}
    ],
    temperature=0.0,
)
```

---

## Cell 41 — TLDR / continuity prompt (substantive context brief for next-day continuity)

```python
tldr_prompt_revised = f"""
You are an information processing agent tasked with creating a **substantive context brief** from a detailed intelligence briefing. Your output will be used by another AI model tomorrow to quickly understand the essential information and developments covered for each major topic today, ensuring continuity without requiring it to re-read the full brief. This requires more detail than just keywords.

**Your Task:**

Read the full intelligence brief provided below within the `<final_brief>` tags. Identify each distinct major story or narrative thread discussed (stories under `<u>**title**</u>` headings are primary candidates, but also consider distinct themes from other sections). For **each** identified story, generate a concise summary capturing its essence *as presented in the brief*.

**Input:**

The input is the full text of the daily intelligence brief generated previously.

<final_brief>
# {brief_title}

{final_brief_text}
</final_brief>

**Required Output Format:**

Your entire output must consist **only** of a list of summaries, one for each identified major story. Each summary should follow this structure:

1.  **Story Identifier:** Start with a concise, descriptive label for the story thread (max 5-6 words, enclosed in square brackets `[]`). Examples: `[US-Venezuela Deportations]`, `[Gaza Ceasefire Talks]`, `[UK Economic Outlook]`, `[AI Energy Consumption Report]`.
2.  **Summary Paragraph:** Immediately following the identifier, provide a **dense summary paragraph (approx. 2-4 sentences, 30-60 words)** covering:
    *   The core issue or topic discussed for this story *in the brief*.
    *   The main developments, updates, or key pieces of information presented *in the brief*.
    *   Mention the most central entities (people, organizations, countries) involved *as discussed in the brief's coverage of this story*.
    *   The goal is to capture the *substance* of what was reported today, providing enough context for the next AI to understand the state of play.

**Example Output Structure:**

```
[US-Venezuela Deportations Restart]
The brief covered the renewed US deportation flights to Venezuela following recent bilateral talks. Key entities mentioned included the US and Venezuelan governments. The focus was on the operational details of the restart and the political context cited for the policy shift.

[Gaza Conflict: Hospital Strike Aftermath]
Significant coverage was given to the aftermath of the Al-Ahli hospital strike. The brief detailed conflicting narratives from the IDF and Palestinian Islamic Jihad regarding responsibility, noted the high reported casualty figures, and mentioned ensuing international reactions and calls for investigation.

[AI Development: Energy Consumption Concerns]
A section discussed reports highlighting the increasing energy demands of large AI models. It referenced findings from specific research groups and tech companies, focusing on concerns about data center power usage, grid impact, and potential environmental consequences discussed in the brief.
```

**Instructions & Constraints:**

*   **Process Entire Brief:** Analyze the *whole* brief to identify all distinct major stories.
*   **Focus on Substance:** Prioritize conveying the *essential information and developments* reported in the brief for each story, not just keywords.
*   **Concise but Informative:** Summaries should be dense and capture key details within the approximate length guidelines (30-60 words).
*   **Coverage, Not Full Analysis:** Reflect *what the brief covered*, not external knowledge or deep analysis beyond what was presented.
*   **No Extra Text:** Do **NOT** include any headers (like "Output:"), introductions, explanations, or conclusions in your output. Output *only* the list of formatted story summaries.

Generate the context brief based *only* on the provided `<final_brief>` text, following the revised format for density and usefulness.
""".strip()

tldr_response = call_llm(
    model="gemini-2.0-flash",
    messages=[
        {"role": "user", "content": tldr_prompt_revised}
    ],
    temperature=0.0,
)
```