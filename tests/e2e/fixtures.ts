// Common test setup, page helpers, auth helpers
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  // Custom fixtures can be added here
});

export { expect };
