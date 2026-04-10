/**
 * Generic helper to create a Supabase Realtime channel subscription
 * with consistent cleanup, logging, and establishment-scoped filtering.
 */

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface CreateRealtimeChannelOptions {
  /** Unique channel name (will be scoped per establishment) */
  channelName: string;
  /** Postgres table to listen on */
  table: string;
  /** Postgres filter string, e.g. `establishment_id=eq.${id}` */
  filter?: string;
  /** Callback invoked on any postgres_changes event */
  onEvent: () => void;
  /** Label for dev-only console logs */
  logLabel: string;
}

/**
 * Creates and subscribes to a Supabase Realtime channel.
 * Returns the channel reference for cleanup.
 */
export function createRealtimeChannel({
  channelName,
  table,
  filter,
  onEvent,
  logLabel,
}: CreateRealtimeChannelOptions): RealtimeChannel {
  const filterConfig: { event: "*"; schema: "public"; table: string; filter?: string } = {
    event: "*",
    schema: "public",
    table,
  };
  if (filter) {
    filterConfig.filter = filter;
  }

  const channel = supabase
    .channel(channelName)
    .on("postgres_changes", filterConfig, () => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[AppRealtimeSync] ${logLabel}`, channelName);
      }
      onEvent();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[AppRealtimeSync] Channel ${channelName} SUBSCRIBED (${table})`);
      }
      if (status === "CHANNEL_ERROR") {
        if (import.meta.env.DEV) {
          console.warn(
            `[AppRealtimeSync] Channel ${channelName} error (${table}) — Supabase will auto-reconnect`
          );
        }
      }
      if (status === "TIMED_OUT") {
        if (import.meta.env.DEV) {
          console.warn(
            `[AppRealtimeSync] Channel ${channelName} timed out (${table}) — Supabase will auto-reconnect`
          );
        }
      }
      if (status === "CLOSED" && import.meta.env.DEV) {
        console.warn(`[AppRealtimeSync] Channel ${channelName} closed (${table})`);
      }
    });

  return channel;
}

/**
 * Safely removes a channel and nulls out the ref.
 */
export function removeChannel(ref: React.MutableRefObject<RealtimeChannel | null>) {
  if (ref.current) {
    supabase.removeChannel(ref.current);
    ref.current = null;
  }
}
