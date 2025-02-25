import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getPreferenceValues, showToast, Toast } from "@raycast/api";
import path from 'path';
import fs from 'fs';
import os from 'os';

// Load environment variables from .env file
dotenv.config();

// Get API key directly from .env file as a fallback
function getApiKey(): string {
  // First try to get from process.env
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "YOUR_ANTHROPIC_API_KEY_HERE") {
    console.log("Using API key from process.env");
    return process.env.ANTHROPIC_API_KEY;
  }
  
  // If not available, try to read from .env file directly
  try {
    // Try multiple possible locations for the .env file
    const possiblePaths = [
      // Current working directory
      path.resolve(process.cwd(), '.env'),
      // Project directory
      path.resolve(__dirname, '..', '.env'),
      // User's home directory
      path.resolve(os.homedir(), 'Documents', 'apps', 'cursor project files', 'search-local-files', '.env')
    ];
    
    console.log("Checking possible .env file locations:");
    
    for (const envPath of possiblePaths) {
      console.log("Checking for .env at:", envPath);
      
      if (fs.existsSync(envPath)) {
        console.log("Found .env file at:", envPath);
        const envContent = fs.readFileSync(envPath, 'utf8');
        console.log(".env file content length:", envContent.length);
        
        // Use a more robust regex that captures the entire line after the key
        const match = envContent.match(/ANTHROPIC_API_KEY=(.+)(\r?\n|$)/);
        if (match && match[1]) {
          const extractedKey = match[1].trim();
          console.log("Extracted API key length:", extractedKey.length);
          
          if (extractedKey !== "YOUR_ANTHROPIC_API_KEY_HERE") {
            console.log("Using API key from .env file");
            return extractedKey;
          }
        } else {
          console.log("No API key match found in .env file at:", envPath);
        }
      }
    }
    
    // If we get here, we didn't find a valid .env file
    console.log("No valid .env file found in any of the checked locations");
    
    // Show a warning that no API key was found
    console.warn("No valid Anthropic API key found. Please add your API key to the .env file.");
    return "";
    
  } catch (error) {
    console.error("Error reading .env file:", error);
  }
  
  // No valid API key found
  console.warn("No valid Anthropic API key found. Please add your API key to the .env file.");
  return "";
}

// Check if we have a valid API key
const apiKey = getApiKey();
const isApiKeyConfigured = apiKey.length > 0;

// Initialize Anthropic client with API key if available
const anthropic = isApiKeyConfigured ? new Anthropic({ apiKey }) : null;

// Maximum number of tokens to generate in the response
const MAX_TOKENS = 150;

/**
 * Checks if the API key is configured and shows a toast if not
 * @returns boolean indicating if the API key is properly configured
 */
function checkApiKeyConfigured(): boolean {
  if (!isApiKeyConfigured) {
    showToast({
      style: Toast.Style.Failure,
      title: "API Key Not Configured",
      message: "Please add your Anthropic API key to the .env file"
    });
    return false;
  }
  return true;
}

/**
 * Generate a response from Claude based on snippet content and context
 * @param snippetWithContext The snippet with surrounding context
 * @param query The user's search query
 * @param onPartialResponse Callback function to handle streaming responses
 * @returns Promise that resolves when streaming is complete
 */
export async function generateEnhancedContext(
  snippetWithContext: string, 
  query: string,
  onPartialResponse: (text: string) => void
): Promise<void> {
  try {
    // Check if API key is configured
    if (!checkApiKeyConfigured()) {
      onPartialResponse("API key not configured. Please add your Anthropic API key to the .env file.");
      return;
    }

    // Extract keywords from the query for better context extraction
    const keywords = await extractKeywordsFromQuery(query);
    const keywordArray = keywords.split(/\s+/).filter(k => k.length > 2);
    
    // Find the most relevant section of the snippets based on keywords
    let relevantContent = snippetWithContext;
    
    // If the snippets are large, try to extract the most relevant section
    if (snippetWithContext.length > 15000) {
      console.log("Snippets are large, extracting relevant sections");
      
      // Find positions of all keywords in the snippets
      const keywordPositions: number[] = [];
      
      keywordArray.forEach(keyword => {
        const regex = new RegExp(keyword, 'gi');
        let match;
        while ((match = regex.exec(snippetWithContext)) !== null) {
          keywordPositions.push(match.index);
        }
      });
      
      if (keywordPositions.length > 0) {
        console.log(`Found ${keywordPositions.length} keyword matches in snippets`);
        
        // Sort positions to find clusters of keywords
        keywordPositions.sort((a, b) => a - b);
        
        // Find the position with the highest density of keywords
        let bestPosition = keywordPositions[0];
        let highestDensity = 0;
        
        keywordPositions.forEach(position => {
          // Count keywords within 5000 characters of this position
          const nearbyKeywords = keywordPositions.filter(
            p => Math.abs(p - position) < 5000
          ).length;
          
          if (nearbyKeywords > highestDensity) {
            highestDensity = nearbyKeywords;
            bestPosition = position;
          }
        });
        
        // Extract 2500 characters before and after the best position
        const startPos = Math.max(0, bestPosition - 2500);
        const endPos = Math.min(snippetWithContext.length, bestPosition + 2500);
        
        relevantContent = snippetWithContext.substring(startPos, endPos);
        console.log(`Extracted ${relevantContent.length} characters around position ${bestPosition}`);
      } else {
        // If no keywords found, use the beginning of the snippets
        relevantContent = snippetWithContext.substring(0, 5000);
        console.log("No keyword matches found, using first 5000 characters");
      }
    }

    // Start with empty response
    let fullResponse = "";
    onPartialResponse("Analyzing content...");

    const stream = await anthropic!.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        {
          role: "user",
          content: `I have the following content from a document:
          
${relevantContent}

The user searched for: "${query}"

This content represents a section of the document that contains keywords related to the user's query.
It includes approximately 5,000 characters before and after the most relevant keyword matches.

Based ONLY on the provided content, answer the user's query directly and precisely.
Focus exclusively on information related to "${query}" in the content.
Be concise but thorough - provide all relevant details from the content that address the query.
If the content doesn't contain information to answer the query, state that clearly.
Do not include phrases like "According to the document" or "The content mentions" - just provide the answer.`
        }
      ],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && 'text' in chunk.delta && chunk.delta.text) {
        fullResponse += chunk.delta.text;
        onPartialResponse(fullResponse);
      }
    }

    // If we somehow got an empty response
    if (!fullResponse) {
      onPartialResponse("No additional context available for this content.");
    }
  } catch (error) {
    console.error("Error generating LLM response:", error);
    onPartialResponse("Sorry, I couldn't analyze this content. An error occurred.");
  }
}

/**
 * Extract keywords from a natural language query
 * @param query The user's natural language query
 * @returns Promise that resolves to extracted keywords for search
 */
export async function extractKeywordsFromQuery(
  query: string
): Promise<string> {
  try {
    // Check if API key is configured
    if (!checkApiKeyConfigured()) {
      console.warn("API key not configured, using original query as fallback");
      return query;
    }

    // Start with empty response
    let fullResponse = "";
    
    const stream = await anthropic!.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        {
          role: "user",
          content: `Extract the most important search keywords and phrases from this query.
          Return ONLY the keywords and phrases separated by spaces, with no explanation or additional text.
          
          Guidelines for extraction:
          1. Preserve exact proper nouns, company names, product names, and technical terms exactly as written
          2. Keep multi-word phrases together when they form a single concept (e.g., "base case capital" should stay together)
          3. Include all specific terms, proper nouns, technical terms, and domain-specific vocabulary
          4. Include important action verbs and descriptive adjectives
          5. Include any dates, numbers, or quantities mentioned
          
          Exclude:
          - Common stop words (the, a, is, are, etc.)
          - Generic question words (what, how, when, etc.) unless they're part of a specific term
          - Redundant or less important terms
          
          Query: "${query}"
          
          Examples:
          - "What is the interest rate on the loan from Acme Bank?" → "interest rate loan Acme Bank"
          - "How large is the first fund from Base Case Capital?" → "large first fund Base Case Capital"
          - "When was the last time we discussed the merger with XYZ Corp?" → "last time discussed merger XYZ Corp"
          - "Show me portfolio companies of Base Case Capital" → "portfolio companies Base Case Capital"
          
          Keywords and phrases:`
        }
      ],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && 'text' in chunk.delta && chunk.delta.text) {
        fullResponse += chunk.delta.text;
      }
    }

    // Clean up the response (remove any explanatory text)
    const cleanedResponse = fullResponse.trim();
    
    console.log(`Original query: "${query}"`);
    console.log(`Extracted keywords: "${cleanedResponse}"`);
    
    return cleanedResponse || query; // Fall back to original query if extraction fails
  } catch (error) {
    console.error("Error extracting keywords:", error);
    return query; // Fall back to original query on error
  }
}

/**
 * Generate a more comprehensive answer to a natural language question based on document content
 * @param documentContent The full content of the document
 * @param originalQuery The user's original natural language query
 * @param onPartialResponse Callback function to handle streaming responses
 * @returns Promise that resolves when streaming is complete
 */
export async function generateAnswerFromDocument(
  documentContent: string, 
  originalQuery: string,
  onPartialResponse: (text: string) => void
): Promise<void> {
  try {
    // Check if API key is configured
    if (!checkApiKeyConfigured()) {
      onPartialResponse("API key not configured. Please add your Anthropic API key to the .env file.");
      return;
    }

    // Extract keywords from the query for better context extraction
    const keywords = await extractKeywordsFromQuery(originalQuery);
    const keywordArray = keywords.split(/\s+/).filter(k => k.length > 2);
    
    // Find the most relevant section of the document based on keywords
    let relevantContent = documentContent;
    
    // If the document is large, try to extract the most relevant section
    if (documentContent.length > 20000) {
      console.log("Document is large, extracting relevant sections");
      
      // Find positions of all keywords in the document
      const keywordPositions: number[] = [];
      
      keywordArray.forEach(keyword => {
        const regex = new RegExp(keyword, 'gi');
        let match;
        while ((match = regex.exec(documentContent)) !== null) {
          keywordPositions.push(match.index);
        }
      });
      
      if (keywordPositions.length > 0) {
        console.log(`Found ${keywordPositions.length} keyword matches in document`);
        
        // Sort positions to find clusters of keywords
        keywordPositions.sort((a, b) => a - b);
        
        // Find the position with the highest density of keywords
        let bestPosition = keywordPositions[0];
        let highestDensity = 0;
        
        keywordPositions.forEach(position => {
          // Count keywords within 10000 characters of this position
          const nearbyKeywords = keywordPositions.filter(
            p => Math.abs(p - position) < 10000
          ).length;
          
          if (nearbyKeywords > highestDensity) {
            highestDensity = nearbyKeywords;
            bestPosition = position;
          }
        });
        
        // Extract 5000 characters before and after the best position
        const startPos = Math.max(0, bestPosition - 5000);
        const endPos = Math.min(documentContent.length, bestPosition + 5000);
        
        relevantContent = documentContent.substring(startPos, endPos);
        console.log(`Extracted ${relevantContent.length} characters around position ${bestPosition}`);
        
        // Add context markers
        if (startPos > 0) {
          relevantContent = "[Document starts earlier...]\n\n" + relevantContent;
        }
        if (endPos < documentContent.length) {
          relevantContent = relevantContent + "\n\n[Document continues...]";
        }
      } else {
        console.log("No keyword matches found, using document summary");
        // If no keywords found, use the beginning and end of the document
        relevantContent = 
          documentContent.substring(0, 5000) + 
          "\n\n[...middle of document omitted...]\n\n" +
          documentContent.substring(documentContent.length - 5000);
      }
    }

    // Start with empty response
    let fullResponse = "";
    onPartialResponse("Analyzing document...");

    const stream = await anthropic!.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        {
          role: "user",
          content: `I have the following content from a document:
          
${relevantContent}

The user asked: "${originalQuery}"

This content represents a section of the document that contains keywords related to the user's query.
It includes approximately 5,000 characters before and after the most relevant keyword matches.

Answer the user's question precisely and comprehensively based ONLY on the information in the provided content.
Focus on delivering a complete answer that addresses all aspects of the question.
Include all relevant details, facts, and context from the document that relate to the question.
If the document contains partial information, provide what's available and note what's missing.
If the document doesn't contain information to answer the question, state "The document doesn't contain information about this."
Be direct - don't use phrases like "According to the document" or "The text states" - just provide the answer.`
        }
      ],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && 'text' in chunk.delta && chunk.delta.text) {
        fullResponse += chunk.delta.text;
        onPartialResponse(fullResponse);
      }
    }

    // If we somehow got an empty response
    if (!fullResponse) {
      onPartialResponse("No information found in the document to answer your question.");
    }
  } catch (error) {
    console.error("Error generating answer:", error);
    onPartialResponse("Sorry, I couldn't analyze this document. An error occurred.");
  }
} 