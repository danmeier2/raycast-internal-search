# Raycast Local File Search with LLM Integration

This Raycast extension provides powerful local file search capabilities with content indexing and LLM-powered analysis features.

## Features

### Search Capabilities
- Fast local file search with content indexing
- Fuzzy matching for filenames and content
- Snippet preview with highlighted search terms
- File type filtering
- Detailed metadata display

### LLM Integration
- File summarization using Anthropic's Claude AI
- Ask questions about file content
- Get AI-powered insights about your files

## Setup

1. Install the extension in Raycast
2. Create a `.env` file in the extension directory with your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```
3. Start the extension server:
   ```
   npm run start
   ```

## Usage

### Basic Search
1. Open Raycast and select "Search local files"
2. Type your search query
3. Browse through the results
4. Use the file type filter to narrow down results

### LLM Features
- Select a file from the search results
- Use the "Summarize File" action to get an AI-generated summary
- Use the "Ask AI About This File" action to ask specific questions about the file content

## Development

### Prerequisites
- Node.js
- Raycast
- Anthropic API key

### Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your Anthropic API key
4. Build and start the server: `npm run start`
5. Open Raycast and run the extension

### Project Structure
- `src/search-local-files.tsx`: Main UI component
- `src/llm-utils.ts`: Utilities for LLM integration
- `src/extension.ts`: Extension lifecycle management
- `server.js`: Backend server for file indexing and search

## License
MIT