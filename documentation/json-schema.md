# JSON Schema Output

## Overview

Generate JSON Schema output for provider tool formats.

Get JSON Schema representation for LLM tool definitions:

The output is plain JSON and safe to serialize.

```typescript
const tool = createTool({
  name: 'my-tool',
  description: 'Does something',
  schema: z.object({ input: z.string() }),
  execute: async () => 'done',
});

const jsonSchema = tool.toJSON();
// {
//   type: 'function',
//   name: 'my-tool',
//   description: 'Does something',
//   strict: true,
//   parameters: { type: 'object', properties: { input: { type: 'string' } }, ... }
// }
```
