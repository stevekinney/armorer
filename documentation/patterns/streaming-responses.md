# Streaming Responses

Implement streaming for large or real-time data.

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Streaming using async generators
const streamData = createTool({
  name: 'stream-data',
  description: 'Stream data in chunks',
  schema: z.object({ query: z.string() }),
  async execute({ query }, { dispatch }) {
    // Simulate streaming
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Emit progress events for each chunk
      dispatch({
        type: 'progress',
        detail: {
          percent: (i + 1) * 10,
          message: `Chunk ${i + 1}/10`,
        },
      });

      // Emit custom event with chunk data
      dispatch({
        type: 'chunk',
        detail: { index: i, data: `Chunk ${i}` },
      });
    }

    return { complete: true, chunks: 10 };
  },
});

// Listen to streaming events
streamData.addEventListener('chunk', (event) => {
  console.log('Received chunk:', event.detail);
});

streamData.addEventListener('progress', (event) => {
  console.log(`Progress: ${event.detail.percent}%`);
});

// Execute
const result = await streamData({ query: 'test' });
```

## Server-Sent Events Pattern

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Tool that returns an async iterator
const streamSSE = createTool({
  name: 'stream-sse',
  description: 'Stream data as SSE',
  schema: z.object({ topic: z.string() }),
  async execute({ topic }) {
    // Return an async iterable
    return {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield { event: 'message', data: `Event ${i} for ${topic}` };
        }
      },
    };
  },
});

// Consume the stream
const stream = await streamSSE({ topic: 'updates' });

if (stream && Symbol.asyncIterator in stream) {
  for await (const event of stream) {
    console.log('SSE Event:', event);
  }
}
```

## Observable Pattern

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Tool that returns an observable-like object
const observeData = createTool({
  name: 'observe-data',
  description: 'Observe data changes',
  schema: z.object({ source: z.string() }),
  async execute({ source }) {
    return {
      subscribe: (observer: {
        next?: (value: any) => void;
        error?: (error: any) => void;
        complete?: () => void;
      }) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          observer.next?.({ count, source });

          if (count >= 5) {
            clearInterval(interval);
            observer.complete?.();
          }
        }, 200);

        return {
          unsubscribe: () => clearInterval(interval),
        };
      },
    };
  },
});

// Subscribe to the observable
const observable = await observeData({ source: 'sensor-1' });

const subscription = observable.subscribe({
  next: (value) => console.log('Value:', value),
  complete: () => console.log('Complete!'),
});

// Unsubscribe after 2 seconds
setTimeout(() => subscription.unsubscribe(), 2000);
```

---
