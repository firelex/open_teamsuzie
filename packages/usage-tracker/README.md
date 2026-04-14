# @teamsuzie/usage-tracker

Redis-backed helper for tracking LLM and embedding usage events.

Services that run LLM or embedding calls (e.g. `llm-proxy`, `vector-db`) use this
package to publish `UsageEvent` messages on the `usage:events` Redis pub/sub channel.
The admin service subscribes to that channel and persists the events for reporting
and quota enforcement.

## Usage

```typescript
import { UsageTracker } from '@teamsuzie/usage-tracker';

const tracker = new UsageTracker({ redisUrl: process.env.REDIS_URL! });

await tracker.record({
    org_id, user_id, agent_id,
    service: 'openai',
    operation: 'chat',
    model: 'gpt-4o',
    input_units: 1234,
    output_units: 567,
});
```

Cost is auto-computed from `COST_RATES` when `cost_estimate` is not provided.
