import type {
  Tool as HomogenaizeTool,
  ToolCall as HomogenaizeToolCall,
  ToolConfig as HomogenaizeToolConfig,
  ToolResult as HomogenaizeToolResult,
} from '@lasercat/homogenaize';
import { describe, expect, it } from 'bun:test';
import type { ZodSchema } from 'zod';

import type { ArmorerTool, ToolConfig } from '../src/is-tool';
import type { ToolCall, ToolResult } from '../src/types';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

type _ToolCallCompat = Assert<IsAssignable<ToolCall, HomogenaizeToolCall>>;
type _ToolCallCompatReverse = Assert<
  IsAssignable<HomogenaizeToolCall, ToolCall>
>;
type _ToolResultCompat = Assert<IsAssignable<ToolResult, HomogenaizeToolResult>>;
type _ToolCompat = Assert<IsAssignable<ArmorerTool, HomogenaizeTool>>;
type _ToolConfigCompat = Assert<
  IsAssignable<ToolConfig, HomogenaizeToolConfig<ZodSchema>>
>;

describe('homogenaize compatibility', () => {
  it('keeps shared tool shapes assignable', () => {
    expect(true).toBe(true);
  });
});
