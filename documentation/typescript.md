# TypeScript

## Overview

TypeScript inference guidance and type-level patterns.

Armorer is written in TypeScript and provides full type inference:

```typescript
const tool = createTool({
  name: 'typed-tool',
  description: 'A typed tool',
  schema: z.object({
    count: z.number(),
    name: z.string().optional(),
  }),
  async execute(params) {
    // params is typed as { count: number; name?: string }
    return params.count * 2;
  },
});

// Return type is inferred
const result = await tool({ count: 5 }); // number
```
