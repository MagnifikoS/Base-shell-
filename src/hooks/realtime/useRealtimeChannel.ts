/**
 * Generic Realtime Channel hook.
 *
 * Encapsulates the repetitive pattern used by all channel hooks:
 *   useRef + useCallback + useEffect (subscribe/cleanup).
 *
 * Each domain-specific hook (useBadgeChannel, usePlanningChannels, etc.)
 * calls this hook instead of duplicating the boilerplate.
 */

import { useEffect, useRef, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createRealtimeChannel, removeChannel } from "./createRealtimeChannel";

export interface RealtimeChannelConfig {
  /** Unique channel name (will be scoped per establishment) */
  channelName: string;
  /** Postgres table to listen on */
  table: string;
  /** Postgres filter string, e.g. `establishment_id=eq.${id}` */
  filter?: string;
  /** Postgres schema to listen on (defaults to "public" in createRealtimeChannel) */
  schema?: string;
  /** Whether the channel should be active */
  enabled: boolean;
  /** Callback invoked on any postgres_changes event */
  onEvent: () => void;
  /** Label for dev-only console logs */
  logLabel: string;
}

/**
 * Manages a single Supabase Realtime channel subscription.
 *
 * - Subscribes when `enabled` is true and config params are present
 * - Automatically cleans up the previous channel on dependency changes
 * - Cleans up on unmount
 */
export function useRealtimeChannel(config: RealtimeChannelConfig) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Stable callback wrapper so effect dependencies stay minimal
  const stableOnEvent = useCallback(() => {
    config.onEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.onEvent]);

  useEffect(() => {
    if (!config.enabled) {
      removeChannel(channelRef);
      return;
    }

    // Tear down previous subscription before re-subscribing
    removeChannel(channelRef);

    channelRef.current = createRealtimeChannel({
      channelName: config.channelName,
      table: config.table,
      filter: config.filter,
      onEvent: stableOnEvent,
      logLabel: config.logLabel,
    });

    return () => removeChannel(channelRef);
  }, [
    config.enabled,
    config.channelName,
    config.table,
    config.filter,
    config.logLabel,
    stableOnEvent,
  ]);
}
