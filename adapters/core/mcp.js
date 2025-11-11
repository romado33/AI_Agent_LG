import { z } from "zod";
import axios from "axios";

// GitHub MCP Integration
export function toolsGitHubMCP(factory) {
  const searchRepositories = factory({
    name: "searchRepositories",
    description: "Search GitHub repositories",
    schema: z.object({
      query: z.string(),
      language: z.string().optional(),
      sort: z.enum(["stars", "forks", "updated"]).default("stars"),
    }),
    impl: async ({ query, language, sort }) => {
      try {
        // In real implementation, use GitHub API
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}${language ? `+language:${language}` : ""}&sort=${sort}`;
        const response = await axios.get(url, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            ...(process.env.GITHUB_TOKEN && {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
            }),
          },
        });
        return {
          total: response.data.total_count,
          repositories: response.data.items.slice(0, 10).map((repo) => ({
            name: repo.full_name,
            description: repo.description,
            stars: repo.stargazers_count,
            language: repo.language,
            url: repo.html_url,
          })),
        };
      } catch (error) {
        return {
          error: error.message,
          note: "GitHub API integration - requires GITHUB_TOKEN for authenticated requests",
        };
      }
    },
  });

  const getRepositoryInfo = factory({
    name: "getRepositoryInfo",
    description: "Get detailed information about a GitHub repository",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    impl: async ({ owner, repo }) => {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}`;
        const response = await axios.get(url, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            ...(process.env.GITHUB_TOKEN && {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
            }),
          },
        });
        return {
          name: response.data.full_name,
          description: response.data.description,
          stars: response.data.stargazers_count,
          forks: response.data.forks_count,
          language: response.data.language,
          topics: response.data.topics,
          url: response.data.html_url,
          createdAt: response.data.created_at,
          updatedAt: response.data.updated_at,
        };
      } catch (error) {
        return {
          error: error.message,
          owner,
          repo,
        };
      }
    },
  });

  const getIssues = factory({
    name: "getIssues",
    description: "Get issues from a GitHub repository",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      state: z.enum(["open", "closed", "all"]).default("open"),
      limit: z.number().default(10),
    }),
    impl: async ({ owner, repo, state, limit }) => {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`;
        const response = await axios.get(url, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            ...(process.env.GITHUB_TOKEN && {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
            }),
          },
        });
        return {
          issues: response.data.map((issue) => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            author: issue.user.login,
            createdAt: issue.created_at,
            url: issue.html_url,
          })),
        };
      } catch (error) {
        return {
          error: error.message,
          owner,
          repo,
        };
      }
    },
  });

  return { searchRepositories, getRepositoryInfo, getIssues };
}

// Browser MCP Integration (simplified - would use Puppeteer/Playwright in production)
export function toolsBrowserMCP(factory) {
  const scrapeWebPage = factory({
    name: "scrapeWebPage",
    description: "Scrape content from a web page",
    schema: z.object({
      url: z.string().url(),
      selector: z.string().optional(),
    }),
    impl: async ({ url, selector }) => {
      try {
        const response = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        // In real implementation, use Cheerio or Puppeteer for better parsing
        return {
          url,
          title: extractTitle(response.data),
          content: extractContent(response.data, selector),
          links: extractLinks(response.data),
          note: "Basic scraping - implement with Cheerio/Puppeteer for better parsing",
        };
      } catch (error) {
        return {
          error: error.message,
          url,
        };
      }
    },
  });

  const searchWeb = factory({
    name: "searchWeb",
    description: "Search the web (would integrate with search APIs)",
    schema: z.object({
      query: z.string(),
      limit: z.number().default(5),
    }),
    impl: async ({ query, limit }) => {
      // In real implementation, use search APIs (Google Custom Search, Bing, etc.)
      return {
        query,
        results: [
          {
            title: "Example Result",
            url: "https://example.com",
            snippet: "Example search result snippet",
            note: "Implement with search API",
          },
        ],
        note: "Requires search API integration (Google Custom Search, Bing, etc.)",
      };
    },
  });

  return { scrapeWebPage, searchWeb };
}

// Notion MCP Integration
export function toolsNotionMCP(factory) {
  const createNotionPage = factory({
    name: "createNotionPage",
    description: "Create a page in Notion",
    schema: z.object({
      title: z.string(),
      content: z.string(),
      parentId: z.string().optional(),
    }),
    impl: async ({ title, content, parentId }) => {
      // In real implementation, use Notion API
      return {
        success: false,
        title,
        note: "Requires Notion API integration with NOTION_API_KEY",
        apiInfo: "Use Notion API to create pages programmatically",
      };
    },
  });

  const searchNotion = factory({
    name: "searchNotion",
    description: "Search Notion pages and databases",
    schema: z.object({
      query: z.string(),
    }),
    impl: async ({ query }) => {
      return {
        query,
        results: [],
        note: "Requires Notion API integration",
      };
    },
  });

  return { createNotionPage, searchNotion };
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1] : "No title found";
}

function extractContent(html, selector) {
  // Basic extraction - would use Cheerio in production
  const textMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (textMatch) {
    return textMatch[1].replace(/<[^>]+>/g, " ").substring(0, 1000);
  }
  return "Content extraction not implemented";
}

function extractLinks(html) {
  const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi);
  const links = [];
  for (const match of linkMatches) {
    if (links.length >= 10) {
      break;
    }
    links.push(match[1]);
  }
  return links;
}

