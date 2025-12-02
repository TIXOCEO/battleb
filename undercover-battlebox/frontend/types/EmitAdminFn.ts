import type { AdminSocketOutbound } from "@/lib/adminTypes";

export type EmitAdminFn = <
  E extends keyof AdminSocketOutbound
>(
  event: E,
  payload: Parameters<AdminSocketOutbound[E]>[0]
) => void;
