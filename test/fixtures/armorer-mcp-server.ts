import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createArmorer } from '../../src/create-armorer';
import { createTool } from '../../src/create-tool';
import { createMCP } from '../../src/mcp';

const armorer = createArmorer();
createTool(
  {
    name: 'sum',
    description: 'adds two numbers',
    schema: z.object({ a: z.number(), b: z.number() }),
    async execute({ a, b }) {
      return a + b;
    },
  },
  armorer,
);

const mcp = createMCP(armorer, { serverInfo: { name: 'armorer-tools', version: '0.1.0' } });
await mcp.connect(new StdioServerTransport());
await new Promise(() => {});
