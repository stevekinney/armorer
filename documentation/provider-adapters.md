# Provider Adapters

## Overview

Export tools to OpenAI, Anthropic, and Gemini tool formats.

Export tools in the format expected by different LLM providers. Each adapter is available as a separate subpath export.

### OpenAI

```typescript
import { toOpenAI } from 'armorer/openai';

// Single tool
const openAITool = toOpenAI(myTool);

// Multiple tools
const openAITools = toOpenAI([tool1, tool2]);

// From registry
const openAITools = toOpenAI(armorer);

// Use with OpenAI SDK
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages,
  tools: toOpenAI(armorer),
});
```

### Anthropic

```typescript
import { toAnthropic } from 'armorer/anthropic';

// Single tool
const anthropicTool = toAnthropic(myTool);

// Multiple tools
const anthropicTools = toAnthropic([tool1, tool2]);

// From registry
const anthropicTools = toAnthropic(armorer);

// Use with Anthropic SDK
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  messages,
  tools: toAnthropic(armorer),
});
```

### Google Gemini

```typescript
import { toGemini } from 'armorer/gemini';

// Single tool
const geminiDeclaration = toGemini(myTool);

// Multiple tools
const geminiDeclarations = toGemini([tool1, tool2]);

// From registry
const geminiDeclarations = toGemini(armorer);

// Use with Gemini SDK
const model = genAI.getGenerativeModel({
  model: 'gemini-pro',
  tools: [{ functionDeclarations: toGemini(armorer) }],
});
```
